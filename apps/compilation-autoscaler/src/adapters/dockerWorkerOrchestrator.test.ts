import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeContainerCpuLoadFraction,
  DockerWorkerOrchestrator,
} from './dockerWorkerOrchestrator.js';

// Regression coverage for a real bug found via live testing: Docker's label
// filter ANDs multiple values together (a container must carry every listed
// label), not ORs them. A container built from the compilation-worker image
// always inherits `com.docker.compose.service=compilation-worker` from the
// image itself, even when created directly by this orchestrator — so a
// single `listContainers` call filtering on that label plus the
// `managed-by` label only ever matched a container carrying BOTH, silently
// never counting the real compose-managed baseline worker (which only ever
// carries the compose label). `listActiveWorkerContainers` must issue two
// separate calls and union the results instead.
const { listContainersMock } = vi.hoisted(() => ({
  listContainersMock: vi.fn(),
}));
vi.mock('dockerode', () => ({
  default: class FakeDocker {
    listContainers = listContainersMock;
  },
}));

const baselineLabelFilter = 'com.docker.compose.service=compilation-worker';
const managedByLabelFilter = 'com.frelated.managed-by=compilation-autoscaler';

const orchestratorConfig = {
  socketPath: '/var/run/docker.sock',
  image: 'frelated-compilation-worker',
  network: 'frelated-network',
  redisUrl: 'redis://redis:6379',
  authSecret: 'secret',
  dataEncryptionKey: 'secret',
  compilationTimeoutMs: 120000,
  gracefulStopTimeoutSeconds: 130,
};

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/** Builds a minimal fake Docker stats snapshot with just the CPU fields the function reads. */
const fakeStats = (params: {
  totalUsage: number;
  preTotalUsage: number;
  systemCpuUsage: number;
  preSystemCpuUsage: number;
  onlineCpus?: number;
}) => ({
  cpu_stats: {
    cpu_usage: { total_usage: params.totalUsage },
    system_cpu_usage: params.systemCpuUsage,
    online_cpus: params.onlineCpus ?? 1,
  },
  precpu_stats: {
    cpu_usage: { total_usage: params.preTotalUsage },
    system_cpu_usage: params.preSystemCpuUsage,
  },
});

describe('computeContainerCpuLoadFraction', () => {
  it('computes 1.0 when a single-CPU container fully consumed its own allotment between samples', () => {
    // Container used all of a 100-unit system-wide window on a 1-CPU box.
    const fraction = computeContainerCpuLoadFraction(
      fakeStats({
        totalUsage: 200,
        preTotalUsage: 100,
        systemCpuUsage: 1_100,
        preSystemCpuUsage: 1_000,
        onlineCpus: 1,
      }),
    );
    expect(fraction).toBeCloseTo(1.0, 5);
  });

  it('computes a fraction below 1.0 for a partially busy container', () => {
    const fraction = computeContainerCpuLoadFraction(
      fakeStats({
        totalUsage: 150,
        preTotalUsage: 100,
        systemCpuUsage: 1_100,
        preSystemCpuUsage: 1_000,
        onlineCpus: 1,
      }),
    );
    expect(fraction).toBeCloseTo(0.5, 5);
  });

  it('scales linearly with the number of online CPUs, for the same raw usage ratio', () => {
    // cpuDelta/systemDelta = 10/100 = 0.1; on an 8-CPU host that 0.1 share
    // of system-wide CPU-time corresponds to 0.8 of a single CPU's worth
    // of capacity — the multiplication by online_cpus in the standard
    // Docker CPU-percent formula.
    const fraction = computeContainerCpuLoadFraction(
      fakeStats({
        totalUsage: 110,
        preTotalUsage: 100,
        systemCpuUsage: 1_100,
        preSystemCpuUsage: 1_000,
        onlineCpus: 8,
      }),
    );
    expect(fraction).toBeCloseTo(0.8, 5);
  });

  it('returns null when there is no valid previous sample yet (system delta is zero)', () => {
    const fraction = computeContainerCpuLoadFraction(
      fakeStats({
        totalUsage: 0,
        preTotalUsage: 0,
        systemCpuUsage: 1_000,
        preSystemCpuUsage: 1_000,
      }),
    );
    expect(fraction).toBeNull();
  });

  it('returns null rather than a negative fraction on a bogus/negative cpu delta', () => {
    const fraction = computeContainerCpuLoadFraction(
      fakeStats({
        totalUsage: 50,
        preTotalUsage: 100,
        systemCpuUsage: 1_100,
        preSystemCpuUsage: 1_000,
      }),
    );
    expect(fraction).toBeNull();
  });

  it('treats a missing online_cpus as at least 1 rather than dividing by zero', () => {
    const fraction = computeContainerCpuLoadFraction({
      cpu_stats: {
        cpu_usage: { total_usage: 200 },
        system_cpu_usage: 1_100,
        online_cpus: 0,
      },
      precpu_stats: {
        cpu_usage: { total_usage: 100 },
        system_cpu_usage: 1_000,
      },
    });
    expect(fraction).toBeCloseTo(1.0, 5);
  });
});

describe('getActiveWorkerCount — label filter union (regression)', () => {
  beforeEach(() => {
    listContainersMock.mockReset();
  });

  it('counts the compose baseline and a self-managed worker together, even though only the managed one carries both labels', async () => {
    listContainersMock.mockImplementation(
      async (options: { filters: { label: string[] } }) => {
        const label = options.filters.label[0];
        if (label === baselineLabelFilter) {
          // A real baseline container: compose label only.
          return [
            {
              Id: 'baseline-1',
              Names: ['/frelated-compilation-worker-1'],
              Created: 1,
            },
          ];
        }
        if (label === managedByLabelFilter) {
          // A real autoscaler-created container: both labels in practice
          // (compose label inherited from the image, managed-by set
          // explicitly), but this call is filtered on managed-by alone.
          return [
            {
              Id: 'managed-1',
              Names: ['/frelated-compilation-worker-auto-x'],
              Created: 2,
            },
          ];
        }
        return [];
      },
    );

    const orchestrator = new DockerWorkerOrchestrator(
      orchestratorConfig,
      silentLogger,
    );
    const count = await orchestrator.getActiveWorkerCount();

    expect(count).toBe(2);
    expect(listContainersMock).toHaveBeenCalledTimes(2);
  });

  it('does not double-count a container that happens to match both filters', async () => {
    const shared = {
      Id: 'same-container',
      Names: ['/frelated-compilation-worker-auto-x'],
      Created: 1,
    };
    listContainersMock.mockResolvedValue([shared]);

    const orchestrator = new DockerWorkerOrchestrator(
      orchestratorConfig,
      silentLogger,
    );
    const count = await orchestrator.getActiveWorkerCount();

    expect(count).toBe(1);
  });

  it('returns zero when neither the baseline nor any managed worker is running', async () => {
    listContainersMock.mockResolvedValue([]);

    const orchestrator = new DockerWorkerOrchestrator(
      orchestratorConfig,
      silentLogger,
    );
    const count = await orchestrator.getActiveWorkerCount();

    expect(count).toBe(0);
  });
});
