import {
  BYTES_PER_MB,
  decideScalingAction,
  type ScalingAction,
  type ScalingPolicyConfig,
} from '../domain/scalingPolicy.js';
import type {
  QueueDepthProvider,
  SystemResourceMonitor,
  WorkerOrchestrator,
} from '../domain/ports.js';
import type { Logger } from '../logging/logger.js';

export interface AutoscalerStatus {
  lastDecision: ScalingAction | null;
  lastTickAt: number | null;
  lastScalingActionAt: number | null;
  lastError: string | null;
}

/**
 * Wires the three ports (queue depth, system resources, worker
 * orchestration) to the pure decision logic in `domain/scalingPolicy.ts`
 * and runs it on an interval. This is the only place that owns the mutable
 * "time since last scaling action" state the cooldown rule needs — the
 * decision function itself stays pure and receives that elapsed time as a
 * plain number.
 *
 * Swapping any of the three collaborators (e.g. a future non-BullMQ queue
 * adapter) needs no change here: this class only ever calls the interfaces
 * in `domain/ports.ts`.
 */
export class AutoscalerService {
  private lastScalingActionAt: number | null = null;
  private lastDecision: ScalingAction | null = null;
  private lastTickAt: number | null = null;
  private lastError: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /**
   * The in-flight cycle's promise, if one is currently running. Found via a
   * real bug: `setInterval` fires every `intervalMs` regardless of whether
   * the previous tick finished — and a tick's own action (creating a real
   * Docker container) can take longer than the poll interval, especially
   * under the exact heavy load that triggers scale-up in the first place.
   * A second tick starting before the first recorded its action
   * (`lastScalingActionAt` is only set *after* `scaleUp`/`scaleDown`
   * resolves) sees stale state and independently decides to act too,
   * silently defeating the cooldown. `tick()` below coalesces overlapping
   * calls into this single promise instead of ever starting a second,
   * concurrent decision cycle.
   */
  private inFlightTick: Promise<ScalingAction> | null = null;

  constructor(
    private readonly queueDepthProvider: QueueDepthProvider,
    private readonly systemResourceMonitor: SystemResourceMonitor,
    private readonly workerOrchestrator: WorkerOrchestrator,
    private readonly config: ScalingPolicyConfig,
    private readonly logger: Logger,
  ) {}

  /**
   * Runs one decision cycle, or — if one is already running — waits for
   * that one instead of starting a new, overlapping cycle. Exposed
   * directly so it is easy to unit test in isolation.
   */
  async tick(now: number = Date.now()): Promise<ScalingAction> {
    if (this.inFlightTick) {
      this.logger.info(
        'skipping tick: the previous one is still running (its action is taking longer than the poll interval) — waiting for it instead of starting a second, overlapping cycle',
      );
      return this.inFlightTick;
    }
    this.inFlightTick = this.runTick(now);
    try {
      return await this.inFlightTick;
    } finally {
      this.inFlightTick = null;
    }
  }

  private async runTick(now: number): Promise<ScalingAction> {
    this.lastTickAt = now;
    try {
      const [
        queueSnapshot,
        resources,
        currentWorkerCount,
        averageActiveWorkerCpuLoadFraction,
      ] = await Promise.all([
        this.queueDepthProvider.getQueueSnapshot(),
        this.systemResourceMonitor.getResources(),
        this.workerOrchestrator.getActiveWorkerCount(),
        this.workerOrchestrator.getAverageActiveWorkerCpuLoadFraction(),
      ]);

      const decision = decideScalingAction(
        {
          waitingJobs: queueSnapshot.waitingCount,
          heavyWaitingJobs: queueSnapshot.heavyWaitingCount,
          averageActiveWorkerCpuLoadFraction,
          currentWorkerCount,
          resources,
          msSinceLastScalingAction:
            this.lastScalingActionAt === null
              ? null
              : now - this.lastScalingActionAt,
        },
        this.config,
      );
      this.lastDecision = decision;
      this.lastError = null;

      this.logger.debug(
        `tick: waitingJobs=${queueSnapshot.waitingCount} heavyWaitingJobs=${queueSnapshot.heavyWaitingCount} currentWorkerCount=${currentWorkerCount} activeWorkerCpuLoad=${averageActiveWorkerCpuLoadFraction === null ? 'n/a' : averageActiveWorkerCpuLoadFraction.toFixed(2)} availableMemoryMB=${Math.round(resources.availableMemoryBytes / BYTES_PER_MB)} hostCpuLoad=${resources.cpuLoadFraction.toFixed(2)} -> ${decision.type} (${decision.reason})`,
      );

      if (decision.type === 'scale-up') {
        this.logger.info(`scaling up: ${decision.reason}`);
        await this.workerOrchestrator.scaleUp();
        this.lastScalingActionAt = now;
      } else if (decision.type === 'scale-down') {
        this.logger.info(`scaling down: ${decision.reason}`);
        await this.workerOrchestrator.scaleDown();
        this.lastScalingActionAt = now;
      }

      return decision;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      this.logger.error('tick failed', error);
      throw error;
    }
  }

  /** Starts the polling loop. Returns a function that stops it. */
  start(intervalMs: number): () => void {
    if (this.timer) throw new Error('AutoscalerService already started');
    this.timer = setInterval(() => {
      void this.tick().catch(() => {
        // Errors are already logged in tick(); a failed cycle must not
        // crash the loop — the next interval simply tries again.
      });
    }, intervalMs);
    this.timer.unref?.();
    return () => this.stop();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getStatus(): AutoscalerStatus {
    return {
      lastDecision: this.lastDecision,
      lastTickAt: this.lastTickAt,
      lastScalingActionAt: this.lastScalingActionAt,
      lastError: this.lastError,
    };
  }
}
