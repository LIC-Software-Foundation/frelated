// Full end-to-end validation against the REAL queue technology currently
// used by the repo (BullMQ/Redis) and the REAL Docker socket: pushes fake
// jobs onto an isolated test queue and asserts a real compilation-worker
// container actually appears, then actually disappears once the queue
// drains.
//
// Skipped by default. To run it:
//   1. `bash run-docker.sh up` at least once, so the `frelated-network`
//      Docker network exists and the `frelated-compilation-worker` image
//      is built.
//   2. A Redis reachable at AUTOSCALER_E2E_REDIS_URL (defaults to
//      redis://localhost:6379/14 — a DB index distinct from both
//      production (0) and apps/projects-api's own integration tests (15),
//      so none of them can interfere with each other).
//   3. Docker socket access at AUTOSCALER_E2E_DOCKER_SOCKET (defaults to
//      /var/run/docker.sock).
//
//   AUTOSCALER_E2E=1 pnpm --filter @frelated/compilation-autoscaler test:e2e
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import Docker from 'dockerode';
import { BullMqQueueDepthProvider } from '../src/adapters/bullMqQueueDepthProvider.js';
import { DockerWorkerOrchestrator } from '../src/adapters/dockerWorkerOrchestrator.js';
import { HostSystemResourceMonitor } from '../src/adapters/hostSystemResourceMonitor.js';
import { AutoscalerService } from '../src/services/autoscalerService.js';
import type { ScalingPolicyConfig } from '../src/domain/scalingPolicy.js';
import type { Logger } from '../src/logging/logger.js';

const enabled = process.env.AUTOSCALER_E2E === '1';

const redisUrl =
  process.env.AUTOSCALER_E2E_REDIS_URL || 'redis://localhost:6379/14';
const dockerSocketPath =
  process.env.AUTOSCALER_E2E_DOCKER_SOCKET || '/var/run/docker.sock';
const dockerNetwork =
  process.env.COMPILATION_WORKER_NETWORK || 'frelated-network';
const workerImage =
  process.env.COMPILATION_WORKER_IMAGE || 'frelated-compilation-worker';
const queueName = 'frelated-latex-autoscaler-e2e-test';
const managedByLabel = 'com.frelated.managed-by=compilation-autoscaler';

const silentLogger: Logger = {
  info: (message) => console.log(`[e2e] ${message}`),
  warn: (message) => console.warn(`[e2e] ${message}`),
  error: (message, error) => console.error(`[e2e] ${message}`, error),
  debug: () => {},
};

describe.skipIf(!enabled)('Compilation autoscaler — end to end', () => {
  let connection: Redis;
  let queue: Queue;
  let docker: Docker;
  let autoscaler: AutoscalerService;

  const config: ScalingPolicyConfig = {
    scaleUpThreshold: 3,
    scaleDownThreshold: 3,
    minWorkers: 0,
    maxWorkers: 10,
    cooldownMs: 0,
    estimatedWorkerMemoryBytes: 320 * 1024 * 1024,
    minFreeMemoryAfterScaleUpBytes: 0, // don't let a constrained CI/dev box block this test on memory
    maxCpuLoadFractionAfterScaleUp: 100, // same, for CPU
    heavyJobCountThreshold: 2,
    busyWorkerCpuLoadThreshold: 0.8,
  };

  const countManagedContainers = async (): Promise<number> => {
    const containers = await docker.listContainers({
      all: false,
      filters: { label: [managedByLabel] },
    });
    return containers.length;
  };

  const waitUntil = async (
    predicate: () => Promise<boolean>,
    timeoutMs: number,
  ) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('Timed out waiting for condition');
  };

  beforeAll(async () => {
    docker = new Docker({ socketPath: dockerSocketPath });
    try {
      await docker.createNetwork({ Name: dockerNetwork });
    } catch (error) {
      // 409 = network already exists, which is the expected case when the
      // rest of the stack is already running.
      const status = (error as { statusCode?: number }).statusCode;
      if (status !== 409) throw error;
    }

    connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    queue = new Queue(queueName, { connection });

    const queueDepthProvider = new BullMqQueueDepthProvider(
      redisUrl,
      queueName,
      3 * 1024 * 1024, // heavyJobPayloadThresholdBytes — not exercised by this test
      silentLogger,
    );
    const systemResourceMonitor = new HostSystemResourceMonitor(silentLogger);
    const workerOrchestrator = new DockerWorkerOrchestrator(
      {
        socketPath: dockerSocketPath,
        image: workerImage,
        network: dockerNetwork,
        redisUrl,
        authSecret: 'e2e-test-secret',
        dataEncryptionKey: 'e2e-test-secret',
        compilationTimeoutMs: 120_000,
        gracefulStopTimeoutSeconds: 5,
      },
      silentLogger,
    );

    autoscaler = new AutoscalerService(
      queueDepthProvider,
      systemResourceMonitor,
      workerOrchestrator,
      config,
      silentLogger,
    );
  }, 30_000);

  beforeEach(async () => {
    await queue.drain(true);
  });

  afterAll(async () => {
    await queue.drain(true);
    await queue.obliterate({ force: true }).catch(() => {});
    await queue.close();
    connection.disconnect();

    // Safety-net cleanup: remove any managed container left over from a
    // failed assertion so repeated local runs start clean.
    const leftovers = await docker.listContainers({
      all: true,
      filters: { label: [managedByLabel] },
    });
    for (const info of leftovers) {
      const container = docker.getContainer(info.Id);
      await container.remove({ force: true }).catch(() => {});
    }
  }, 30_000);

  it('creates a real compilation-worker container once the queue backs up beyond the threshold', async () => {
    expect(await countManagedContainers()).toBe(0);

    for (let i = 0; i < 4; i += 1) {
      await queue.add('compile', {});
    }

    const decision = await autoscaler.tick();
    expect(decision.type).toBe('scale-up');

    await waitUntil(async () => (await countManagedContainers()) === 1, 20_000);
  }, 45_000);

  it('destroys the extra worker once the queue drains back below the threshold', async () => {
    expect(await countManagedContainers()).toBe(1);

    await queue.drain(true);

    const decision = await autoscaler.tick();
    expect(decision.type).toBe('scale-down');

    await waitUntil(async () => (await countManagedContainers()) === 0, 20_000);
  }, 45_000);
});
