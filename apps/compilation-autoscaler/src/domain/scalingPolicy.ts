import type { SystemResources } from './ports.js';

/**
 * Pure decision logic for compilation-worker autoscaling.
 *
 * Nothing in this file touches Docker, a real queue, or the real clock —
 * every input arrives as a plain value, which is what makes it fully
 * testable without any of those dependencies. `services/autoscalerService.ts`
 * is the only place that wires this to real side effects.
 */

/**
 * Absolute worker ceiling, as a hard-coded safety net rather than a mere
 * default: no configuration is allowed to push `maxWorkers` past this,
 * however generous the resource check would otherwise be. See
 * `clampMaxWorkers`, used when assembling config from the environment.
 */
export const ABSOLUTE_MAX_WORKERS_CEILING = 10;

/** Clamps a configured worker ceiling to never exceed the absolute safety net. */
export function clampMaxWorkers(configuredMaxWorkers: number): number {
  return Math.min(configuredMaxWorkers, ABSOLUTE_MAX_WORKERS_CEILING);
}

export type ScalingActionType = 'scale-up' | 'scale-down' | 'hold';

export interface ScalingAction {
  type: ScalingActionType;
  /** Human-readable explanation, always present so decisions are logged clearly. */
  reason: string;
}

export interface ScalingPolicyConfig {
  /** Waiting-job count strictly above this triggers a scale-up candidate. */
  scaleUpThreshold: number;
  /** Waiting-job count strictly below this triggers a scale-down candidate. */
  scaleDownThreshold: number;
  /** Never scale below this many active workers. */
  minWorkers: number;
  /** Absolute hard cap — never exceeded regardless of resources or demand. */
  maxWorkers: number;
  /** Minimum time between two consecutive scaling actions, in milliseconds. */
  cooldownMs: number;
  /**
   * Comfortable estimate of the extra memory a new worker will need once it
   * is compiling (idle footprint + a real compilation's peak), in bytes.
   * Deliberately generous relative to the measured ~150-265MB peak so
   * heavier documents (images, bibliographies, TikZ) don't blow the budget.
   */
  estimatedWorkerMemoryBytes: number;
  /**
   * Free memory that must remain available *after* accounting for the new
   * worker's estimated footprint. This is the actual safety margin, not
   * the footprint estimate itself.
   */
  minFreeMemoryAfterScaleUpBytes: number;
  /**
   * Maximum normalized CPU load (0..1+) tolerated *after* projecting the
   * extra load a new worker's compilation would add. Prevents scaling up
   * just because current load looks fine while ignoring the CPU the new
   * worker itself is about to consume.
   */
  maxCpuLoadFractionAfterScaleUp: number;
  /**
   * Number of "heavy" waiting jobs (see `QueueSnapshot.heavyWaitingCount`)
   * that alone justifies considering a scale-up, even while the raw
   * waiting count stays under `scaleUpThreshold`. Catches a couple of
   * large documents piling up without waiting for enough small ones to
   * cross the normal threshold.
   */
  heavyJobCountThreshold: number;
  /**
   * Fraction of their own CPU allotment (see
   * `WorkerOrchestrator.getAverageActiveWorkerCpuLoadFraction`) active
   * workers must average, while at least one job is waiting, for that real
   * load to alone justify considering a scale-up. This reacts to genuine
   * observed busyness instead of guessing from job content.
   */
  busyWorkerCpuLoadThreshold: number;
}

/** Named unit, so a bare `* 1024 * 1024` never has to be read as "what unit is this?" again. */
export const BYTES_PER_MB = 1024 * 1024;

export const defaultScalingPolicyConfig: ScalingPolicyConfig = {
  scaleUpThreshold: 3,
  scaleDownThreshold: 3,
  minWorkers: 1,
  maxWorkers: 10,
  cooldownMs: 30_000,
  // A simple document compiles in ~800ms using +60-150MB above the ~90-115MB
  // idle footprint. 320MB stays comfortably above that measured peak to
  // leave room for heavier documents (images, bibliography, TikZ).
  estimatedWorkerMemoryBytes: 320 * BYTES_PER_MB,
  // Keep at least ~768MB free after the new worker's estimated footprint,
  // inside the 500MB-1GB comfortable margin called for in the spec.
  minFreeMemoryAfterScaleUpBytes: 768 * BYTES_PER_MB,
  maxCpuLoadFractionAfterScaleUp: 0.85,
  heavyJobCountThreshold: 2,
  busyWorkerCpuLoadThreshold: 0.8,
};

export interface ResourceCheckResult {
  sufficient: boolean;
  reason: string;
}

/**
 * Checks whether the host has real spare capacity for one more worker —
 * not merely "not yet at 100%", but a comfortable margin after projecting
 * that worker's own footprint. This is the primary gate scale-up decisions
 * must pass, ahead of anything queue-depth related.
 */
export function checkResourcesForOneMoreWorker(
  resources: SystemResources,
  config: ScalingPolicyConfig,
): ResourceCheckResult {
  const freeMemoryAfterScaleUp =
    resources.availableMemoryBytes - config.estimatedWorkerMemoryBytes;
  if (freeMemoryAfterScaleUp < config.minFreeMemoryAfterScaleUpBytes) {
    const availableMb = Math.round(
      resources.availableMemoryBytes / BYTES_PER_MB,
    );
    const marginMb = Math.round(
      config.minFreeMemoryAfterScaleUpBytes / BYTES_PER_MB,
    );
    return {
      sufficient: false,
      reason: `insufficient memory margin: ${availableMb}MB available would leave less than the required ${marginMb}MB free after a new worker's estimated footprint`,
    };
  }

  const projectedCpuLoad =
    resources.cpuLoadFraction + 1 / Math.max(1, resources.cpuCount);
  if (projectedCpuLoad > config.maxCpuLoadFractionAfterScaleUp) {
    return {
      sufficient: false,
      reason: `insufficient CPU margin: projected load ${(projectedCpuLoad * 100).toFixed(0)}% would exceed the ${(config.maxCpuLoadFractionAfterScaleUp * 100).toFixed(0)}% ceiling after a new worker`,
    };
  }

  return { sufficient: true, reason: 'sufficient memory and CPU margin' };
}

export interface ScalingPolicyInput {
  /** Number of jobs currently waiting in the compilation queue. */
  waitingJobs: number;
  /**
   * Of those, how many look "heavy" (see `QueueSnapshot.heavyWaitingCount`).
   * A proxy signal, not a precise measurement.
   */
  heavyWaitingJobs: number;
  /**
   * Average real CPU load of currently active workers, as a fraction of
   * their own CPU allotment. `null` when it cannot be determined —
   * treated as "no signal" rather than "idle" or "busy".
   */
  averageActiveWorkerCpuLoadFraction: number | null;
  /** Number of compilation-worker containers currently active. */
  currentWorkerCount: number;
  /** Host resource snapshot at decision time. */
  resources: SystemResources;
  /**
   * Milliseconds elapsed since the last scale-up/scale-down action, or
   * `null` if no scaling action has happened yet (e.g. right after start).
   */
  msSinceLastScalingAction: number | null;
}

/**
 * Decides the single next scaling action, applying (in priority order):
 *
 * 1. Hard ceiling safety net — correcting an over-the-cap fleet is never
 *    subject to cooldown, because leaving the machine over budget is worse
 *    than one extra scaling action.
 * 2. Anti-flapping cooldown.
 * 3. Floor restoration — if the fleet ever dips under the configured
 *    minimum, restoring it takes priority over the queue-depth signal
 *    (but is still resource-gated: safety never yields, even for the floor).
 * 4. Scale-up, triggered by any of three independent signals — raw queue
 *    depth above threshold, a couple of "heavy" jobs piling up, or active
 *    workers genuinely busy while something waits — gated by the hard
 *    ceiling and the resource check.
 * 5. Queue-depth-driven scale-down, gated by the floor.
 */
export function decideScalingAction(
  input: ScalingPolicyInput,
  config: ScalingPolicyConfig,
): ScalingAction {
  if (input.currentWorkerCount > config.maxWorkers) {
    return {
      type: 'scale-down',
      reason: `fleet has ${input.currentWorkerCount} workers, above the hard ceiling of ${config.maxWorkers}; correcting immediately regardless of cooldown`,
    };
  }

  const withinCooldown =
    input.msSinceLastScalingAction !== null &&
    input.msSinceLastScalingAction < config.cooldownMs;
  if (withinCooldown) {
    return {
      type: 'hold',
      reason: `cooldown active: ${input.msSinceLastScalingAction}ms since last scaling action, below the ${config.cooldownMs}ms minimum`,
    };
  }

  if (input.currentWorkerCount < config.minWorkers) {
    const check = checkResourcesForOneMoreWorker(input.resources, config);
    if (!check.sufficient) {
      return {
        type: 'hold',
        reason: `below the floor of ${config.minWorkers} workers (currently ${input.currentWorkerCount}) but refusing to scale up: ${check.reason}`,
      };
    }
    return {
      type: 'scale-up',
      reason: `below the floor of ${config.minWorkers} workers (currently ${input.currentWorkerCount}); restoring the minimum`,
    };
  }

  const countSignal = input.waitingJobs > config.scaleUpThreshold;
  const heavyJobSignal =
    input.heavyWaitingJobs >= config.heavyJobCountThreshold;
  // Only meaningful while something is actually waiting: busy workers with
  // an empty queue just means they're doing their job, not that more
  // capacity would help.
  const realLoadSignal =
    input.waitingJobs > 0 &&
    input.averageActiveWorkerCpuLoadFraction !== null &&
    input.averageActiveWorkerCpuLoadFraction >=
      config.busyWorkerCpuLoadThreshold;

  if (countSignal || heavyJobSignal || realLoadSignal) {
    const signalDescription = countSignal
      ? `${input.waitingJobs} jobs waiting, above the scale-up threshold of ${config.scaleUpThreshold}`
      : heavyJobSignal
        ? `${input.heavyWaitingJobs} heavy jobs waiting, at or above the threshold of ${config.heavyJobCountThreshold}`
        : `active workers averaging ${((input.averageActiveWorkerCpuLoadFraction as number) * 100).toFixed(0)}% of their own CPU allotment while ${input.waitingJobs} job(s) wait`;

    if (input.currentWorkerCount >= config.maxWorkers) {
      return {
        type: 'hold',
        reason: `${signalDescription}, but already at the hard ceiling of ${config.maxWorkers} workers`,
      };
    }
    const check = checkResourcesForOneMoreWorker(input.resources, config);
    if (!check.sufficient) {
      return {
        type: 'hold',
        reason: `${signalDescription}, but refusing to scale up: ${check.reason}`,
      };
    }
    return {
      type: 'scale-up',
      reason: signalDescription,
    };
  }

  if (input.waitingJobs < config.scaleDownThreshold) {
    if (input.currentWorkerCount <= config.minWorkers) {
      return {
        type: 'hold',
        reason: `${input.waitingJobs} jobs waiting (below ${config.scaleDownThreshold}) but already at the floor of ${config.minWorkers} workers`,
      };
    }
    return {
      type: 'scale-down',
      reason: `${input.waitingJobs} jobs waiting, below the scale-down threshold of ${config.scaleDownThreshold}`,
    };
  }

  return {
    type: 'hold',
    reason: `${input.waitingJobs} jobs waiting is within the stable band [${config.scaleDownThreshold}, ${config.scaleUpThreshold}]`,
  };
}
