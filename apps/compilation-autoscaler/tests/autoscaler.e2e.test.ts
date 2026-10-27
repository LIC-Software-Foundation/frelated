// Optional Docker E2E. Queue depth is exposed through an HTTP boundary,
// matching production; no Redis/BullMQ client is imported by the autoscaler.
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Docker from 'dockerode';
import { HttpQueueDepthProvider } from '../src/adapters/httpQueueDepthProvider.js';
import { DockerWorkerOrchestrator } from '../src/adapters/dockerWorkerOrchestrator.js';
import { HostSystemResourceMonitor } from '../src/adapters/hostSystemResourceMonitor.js';
import { AutoscalerService } from '../src/services/autoscalerService.js';
import type { ScalingPolicyConfig } from '../src/domain/scalingPolicy.js';
import type { Logger } from '../src/logging/logger.js';

const enabled = process.env.AUTOSCALER_E2E === '1';
const dockerSocketPath =
  process.env.AUTOSCALER_E2E_DOCKER_SOCKET || '/var/run/docker.sock';
const dockerNetwork =
  process.env.COMPILATION_WORKER_NETWORK || 'frelated-network';
const workerImage =
  process.env.COMPILATION_WORKER_IMAGE || 'frelated-compilation-worker';
const managedByLabel = 'com.frelated.managed-by=compilation-autoscaler';
const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

describe.skipIf(!enabled)('Compilation autoscaler — HTTP boundary E2E', () => {
  let waitingCount = 0;
  let metricsServer: Server;
  let metricsUrl: string;
  let docker: Docker;
  let autoscaler: AutoscalerService;

  const policy: ScalingPolicyConfig = {
    scaleUpThreshold: 3,
    scaleDownThreshold: 3,
    minWorkers: 0,
    maxWorkers: 10,
    cooldownMs: 0,
    estimatedWorkerMemoryBytes: 320 * 1024 * 1024,
    minFreeMemoryAfterScaleUpBytes: 0,
    maxCpuLoadFractionAfterScaleUp: 100,
    heavyJobCountThreshold: 2,
    busyWorkerCpuLoadThreshold: 0.8,
  };
  const countManaged = async () =>
    (
      await docker.listContainers({
        all: false,
        filters: { label: [managedByLabel] },
      })
    ).length;

  beforeAll(async () => {
    metricsServer = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ waitingCount, heavyWaitingCount: 0 }));
    });
    await new Promise<void>((resolve) =>
      metricsServer.listen(0, '127.0.0.1', resolve),
    );
    const address = metricsServer.address();
    if (!address || typeof address === 'string')
      throw new Error('metrics server unavailable');
    metricsUrl = `http://127.0.0.1:${address.port}`;
    docker = new Docker({ socketPath: dockerSocketPath });
    try {
      await docker.createNetwork({ Name: dockerNetwork });
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode !== 409) throw error;
    }
    const provider = new HttpQueueDepthProvider(
      metricsUrl,
      'token',
      3000,
      silentLogger,
    );
    const orchestrator = new DockerWorkerOrchestrator(
      {
        socketPath: dockerSocketPath,
        image: workerImage,
        network: dockerNetwork,
        redisUrl: 'redis://redis:6379',
        compilationServiceUrl: 'http://compilation-queue-service:3200',
        compilationServiceToken: 'worker-token',
        authSecret: 'e2e-secret',
        dataEncryptionKey: 'e2e-secret',
        compilationTimeoutMs: 120000,
        workerMemoryBytes: 768 * 1024 * 1024,
        workerNanoCpus: 1_000_000_000,
        workerPidsLimit: 128,
        workerTmpfsSizeMb: 384,
        gracefulStopTimeoutSeconds: 5,
      },
      silentLogger,
    );
    autoscaler = new AutoscalerService(
      provider,
      new HostSystemResourceMonitor(silentLogger),
      orchestrator,
      policy,
      silentLogger,
    );
  }, 30000);

  afterAll(async () => {
    await new Promise<void>((resolve) => metricsServer?.close(() => resolve()));
    const leftovers = await docker?.listContainers({
      all: true,
      filters: { label: [managedByLabel] },
    });
    for (const info of leftovers ?? [])
      await docker
        .getContainer(info.Id)
        .remove({ force: true })
        .catch(() => {});
  }, 30000);

  it('scales up and down from metrics obtained over HTTP', async () => {
    expect(await countManaged()).toBe(0);
    waitingCount = 4;
    expect((await autoscaler.tick()).type).toBe('scale-up');
    expect(await countManaged()).toBe(1);
    waitingCount = 0;
    expect((await autoscaler.tick()).type).toBe('scale-down');
    expect(await countManaged()).toBe(0);
  }, 45000);
});
