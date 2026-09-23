import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoscalerService } from './autoscalerService.js';
import { defaultScalingPolicyConfig } from '../domain/scalingPolicy.js';
import type {
  QueueDepthProvider,
  SystemResourceMonitor,
  SystemResources,
  WorkerOrchestrator,
} from '../domain/ports.js';
import type { Logger } from '../logging/logger.js';

/** In-memory fake standing in for the real BullMQ adapter. */
class FakeQueueDepthProvider implements QueueDepthProvider {
  waitingJobCount = 0;
  heavyWaitingJobCount = 0;
  async getQueueSnapshot() {
    return {
      waitingCount: this.waitingJobCount,
      heavyWaitingCount: this.heavyWaitingJobCount,
    };
  }
}

/** In-memory fake standing in for the real /proc-based resource monitor. */
class FakeSystemResourceMonitor implements SystemResourceMonitor {
  resources: SystemResources = {
    totalMemoryBytes: 16 * 1024 * 1024 * 1024,
    availableMemoryBytes: 8 * 1024 * 1024 * 1024,
    cpuCount: 8,
    cpuLoadFraction: 0.1,
  };
  async getResources(): Promise<SystemResources> {
    return this.resources;
  }
}

/** In-memory fake standing in for the real Docker-backed orchestrator. */
class FakeWorkerOrchestrator implements WorkerOrchestrator {
  workerCount: number;
  averageActiveWorkerCpuLoadFraction: number | null = null;
  scaleUpCalls = 0;
  scaleDownCalls = 0;

  constructor(initialWorkerCount: number) {
    this.workerCount = initialWorkerCount;
  }

  async getActiveWorkerCount(): Promise<number> {
    return this.workerCount;
  }

  async getAverageActiveWorkerCpuLoadFraction(): Promise<number | null> {
    return this.averageActiveWorkerCpuLoadFraction;
  }

  /** Lets a test simulate a slow real Docker container creation. */
  scaleUpGate: Promise<void> | null = null;

  async scaleUp(): Promise<void> {
    if (this.scaleUpGate) await this.scaleUpGate;
    this.scaleUpCalls += 1;
    this.workerCount += 1;
  }

  async scaleDown(): Promise<void> {
    this.scaleDownCalls += 1;
    this.workerCount -= 1;
  }
}

const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

describe('AutoscalerService', () => {
  let queue: FakeQueueDepthProvider;
  let resources: FakeSystemResourceMonitor;
  let orchestrator: FakeWorkerOrchestrator;
  let service: AutoscalerService;

  beforeEach(() => {
    queue = new FakeQueueDepthProvider();
    resources = new FakeSystemResourceMonitor();
    orchestrator = new FakeWorkerOrchestrator(2);
    service = new AutoscalerService(
      queue,
      resources,
      orchestrator,
      defaultScalingPolicyConfig,
      silentLogger,
    );
  });

  it('calls scaleUp on the orchestrator when the queue is backed up and resources allow it', async () => {
    queue.waitingJobCount = 10;
    const decision = await service.tick(1_000);
    expect(decision.type).toBe('scale-up');
    expect(orchestrator.scaleUpCalls).toBe(1);
    expect(orchestrator.workerCount).toBe(3);
  });

  it('calls scaleDown on the orchestrator when the queue is quiet and above the floor', async () => {
    queue.waitingJobCount = 0;
    const decision = await service.tick(1_000);
    expect(decision.type).toBe('scale-down');
    expect(orchestrator.scaleDownCalls).toBe(1);
    expect(orchestrator.workerCount).toBe(1);
  });

  it('calls scaleUp when the queue snapshot reports heavy jobs, even while the raw count stays under threshold', async () => {
    queue.waitingJobCount = 2; // under scaleUpThreshold (3)
    queue.heavyWaitingJobCount =
      defaultScalingPolicyConfig.heavyJobCountThreshold;
    const decision = await service.tick(1_000);
    expect(decision.type).toBe('scale-up');
    expect(orchestrator.scaleUpCalls).toBe(1);
  });

  it('calls scaleUp when the orchestrator reports active workers genuinely busy while something waits', async () => {
    queue.waitingJobCount = 1; // under scaleUpThreshold (3)
    orchestrator.averageActiveWorkerCpuLoadFraction =
      defaultScalingPolicyConfig.busyWorkerCpuLoadThreshold + 0.1;
    const decision = await service.tick(1_000);
    expect(decision.type).toBe('scale-up');
    expect(orchestrator.scaleUpCalls).toBe(1);
  });

  it('never calls scaleUp when the resource monitor reports insufficient headroom, even under heavy queue pressure', async () => {
    queue.waitingJobCount = 50;
    resources.resources = {
      totalMemoryBytes: 1024 * 1024 * 1024,
      availableMemoryBytes: 50 * 1024 * 1024,
      cpuCount: 2,
      cpuLoadFraction: 0.1,
    };
    const decision = await service.tick(1_000);
    expect(decision.type).toBe('hold');
    expect(orchestrator.scaleUpCalls).toBe(0);
  });

  it('tracks elapsed time since the last scaling action and enforces the cooldown across ticks', async () => {
    queue.waitingJobCount = 10;
    const first = await service.tick(0);
    expect(first.type).toBe('scale-up');
    expect(orchestrator.scaleUpCalls).toBe(1);

    // Still well inside the cooldown window a moment later.
    const second = await service.tick(1_000);
    expect(second.type).toBe('hold');
    expect(orchestrator.scaleUpCalls).toBe(1);

    // Cooldown has now fully elapsed.
    const third = await service.tick(defaultScalingPolicyConfig.cooldownMs + 1);
    expect(third.type).toBe('scale-up');
    expect(orchestrator.scaleUpCalls).toBe(2);
  });

  it('coalesces an overlapping tick() call into the one already running, instead of starting a second cycle (regression)', async () => {
    // Reproduces a real bug found via live testing: `setInterval` fires
    // every pollIntervalMs regardless of whether the previous tick
    // finished. If a tick's own action (creating a real Docker container)
    // takes longer than that interval, a second tick can start before the
    // first records `lastScalingActionAt` — seeing the same stale state,
    // it independently decides to scale up too, silently bypassing the
    // cooldown. Two real workers got created a few seconds apart in
    // production because of exactly this.
    queue.waitingJobCount = 10;
    let releaseScaleUp!: () => void;
    orchestrator.scaleUpGate = new Promise((resolve) => {
      releaseScaleUp = resolve;
    });

    const first = service.tick(1_000);
    // Fired while the first call's scaleUp() is still blocked — simulates
    // the next setInterval tick landing before the slow action finishes.
    const second = service.tick(1_000);

    // Give both promise chains a chance to run up to the point where
    // they'd be blocked on the gate, without actually resolving it yet.
    await Promise.resolve();
    await Promise.resolve();
    expect(orchestrator.scaleUpCalls).toBe(0); // neither has gotten through yet

    releaseScaleUp();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(orchestrator.scaleUpCalls).toBe(1); // only one real action, not two
    expect(firstResult).toBe(secondResult); // both callers got the same cycle's result
  });

  it('never drives the orchestrator-reported worker count below the configured floor over repeated ticks', async () => {
    queue.waitingJobCount = 0;
    let now = 0;
    for (let i = 0; i < 10; i += 1) {
      now += defaultScalingPolicyConfig.cooldownMs + 1;
      await service.tick(now);
    }
    expect(orchestrator.workerCount).toBeGreaterThanOrEqual(
      defaultScalingPolicyConfig.minWorkers,
    );
  });

  it('never drives the orchestrator-reported worker count above the configured ceiling over repeated ticks', async () => {
    queue.waitingJobCount = 1000;
    let now = 0;
    for (let i = 0; i < 20; i += 1) {
      now += defaultScalingPolicyConfig.cooldownMs + 1;
      await service.tick(now);
    }
    expect(orchestrator.workerCount).toBeLessThanOrEqual(
      defaultScalingPolicyConfig.maxWorkers,
    );
  });

  it('exposes the last decision and last scaling action time via getStatus', async () => {
    queue.waitingJobCount = 10;
    await service.tick(5_000);
    const status = service.getStatus();
    expect(status.lastDecision?.type).toBe('scale-up');
    expect(status.lastScalingActionAt).toBe(5_000);
    expect(status.lastTickAt).toBe(5_000);
    expect(status.lastError).toBeNull();
  });

  it('records the error on getStatus and rejects when a collaborator throws, without crashing the service', async () => {
    vi.spyOn(queue, 'getQueueSnapshot').mockRejectedValue(
      new Error('redis down'),
    );
    await expect(service.tick(1_000)).rejects.toThrow('redis down');
    expect(service.getStatus().lastError).toBe('redis down');
  });

  it('start/stop wires an interval that calls tick and can be torn down cleanly', async () => {
    vi.useFakeTimers();
    try {
      queue.waitingJobCount = 10;
      const stop = service.start(1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(orchestrator.scaleUpCalls).toBeGreaterThanOrEqual(1);
      stop();
      const callsAfterStop = orchestrator.scaleUpCalls;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(orchestrator.scaleUpCalls).toBe(callsAfterStop);
    } finally {
      vi.useRealTimers();
    }
  });
});
