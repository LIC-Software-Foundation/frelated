import { describe, expect, it } from 'vitest';
import {
  ABSOLUTE_MAX_WORKERS_CEILING,
  checkResourcesForOneMoreWorker,
  clampMaxWorkers,
  decideScalingAction,
  defaultScalingPolicyConfig,
  type ScalingPolicyConfig,
  type ScalingPolicyInput,
} from './scalingPolicy.js';
import type { SystemResources } from './ports.js';

const abundantResources: SystemResources = {
  totalMemoryBytes: 16 * 1024 * 1024 * 1024,
  availableMemoryBytes: 8 * 1024 * 1024 * 1024,
  cpuCount: 8,
  cpuLoadFraction: 0.1,
};

const scarceResources: SystemResources = {
  totalMemoryBytes: 2 * 1024 * 1024 * 1024,
  availableMemoryBytes: 200 * 1024 * 1024,
  cpuCount: 2,
  cpuLoadFraction: 0.2,
};

const busyCpuResources: SystemResources = {
  totalMemoryBytes: 16 * 1024 * 1024 * 1024,
  availableMemoryBytes: 8 * 1024 * 1024 * 1024,
  cpuCount: 2,
  cpuLoadFraction: 0.9,
};

const baseInput = (
  overrides: Partial<ScalingPolicyInput> = {},
): ScalingPolicyInput => ({
  waitingJobs: 0,
  heavyWaitingJobs: 0,
  averageActiveWorkerCpuLoadFraction: null,
  currentWorkerCount: defaultScalingPolicyConfig.minWorkers,
  resources: abundantResources,
  msSinceLastScalingAction: null,
  ...overrides,
});

describe('checkResourcesForOneMoreWorker', () => {
  it('reports sufficient margin when memory and CPU both have headroom', () => {
    const result = checkResourcesForOneMoreWorker(
      abundantResources,
      defaultScalingPolicyConfig,
    );
    expect(result.sufficient).toBe(true);
  });

  it('refuses when free memory after the estimated footprint would fall below the configured margin', () => {
    const result = checkResourcesForOneMoreWorker(
      scarceResources,
      defaultScalingPolicyConfig,
    );
    expect(result.sufficient).toBe(false);
    expect(result.reason).toContain('memory');
  });

  it('refuses when projected CPU load after one more worker would exceed the ceiling', () => {
    const result = checkResourcesForOneMoreWorker(
      busyCpuResources,
      defaultScalingPolicyConfig,
    );
    expect(result.sufficient).toBe(false);
    expect(result.reason).toContain('CPU');
  });

  it('is not fooled by "not yet at 100%": a small core count amplifies one more worker\'s marginal load', () => {
    const nearlyMaxedSingleCore: SystemResources = {
      totalMemoryBytes: 8 * 1024 * 1024 * 1024,
      availableMemoryBytes: 4 * 1024 * 1024 * 1024,
      cpuCount: 1,
      cpuLoadFraction: 0.2,
    };
    // Current load looks low (20%), but on a single core, one more worker's
    // marginal 1/cpuCount share alone would push projected load to 120%.
    const result = checkResourcesForOneMoreWorker(
      nearlyMaxedSingleCore,
      defaultScalingPolicyConfig,
    );
    expect(result.sufficient).toBe(false);
  });
});

describe('decideScalingAction — queue-depth thresholds', () => {
  it('considers scaling up when waiting jobs are strictly above the threshold (>3)', () => {
    const decision = decideScalingAction(
      baseInput({ waitingJobs: 4, currentWorkerCount: 2 }),
      defaultScalingPolicyConfig,
    );
    expect(decision.type).toBe('scale-up');
  });

  it('considers scaling down when waiting jobs are strictly below the threshold (<3)', () => {
    const decision = decideScalingAction(
      baseInput({ waitingJobs: 2, currentWorkerCount: 3 }),
      defaultScalingPolicyConfig,
    );
    expect(decision.type).toBe('scale-down');
  });

  it('holds exactly at the threshold value (neither strictly above nor below)', () => {
    const decision = decideScalingAction(
      baseInput({ waitingJobs: 3, currentWorkerCount: 3 }),
      defaultScalingPolicyConfig,
    );
    expect(decision.type).toBe('hold');
  });

  it('holds with zero jobs waiting when already at the floor', () => {
    const decision = decideScalingAction(
      baseInput({ waitingJobs: 0, currentWorkerCount: 1 }),
      defaultScalingPolicyConfig,
    );
    expect(decision.type).toBe('hold');
  });
});

describe('decideScalingAction — heavy waiting jobs (payload-size proxy)', () => {
  it('scales up on heavy jobs alone, even while the raw count stays under the normal threshold', () => {
    const decision = decideScalingAction(
      baseInput({
        waitingJobs: 2, // under scaleUpThreshold (3)
        heavyWaitingJobs: 2, // at defaultScalingPolicyConfig.heavyJobCountThreshold
        currentWorkerCount: 2,
      }),
      defaultScalingPolicyConfig,
    );
    expect(decision.type).toBe('scale-up');
    expect(decision.reason).toContain('heavy');
  });

  it('does not scale up on heavy jobs below the configured count threshold', () => {
    const decision = decideScalingAction(
      baseInput({
        waitingJobs: 3, // neutral band, so no other signal masks the assertion
        heavyWaitingJobs: 1, // below the threshold of 2
        currentWorkerCount: 2,
      }),
      defaultScalingPolicyConfig,
    );
    expect(decision.type).toBe('hold');
  });

  it('still refuses to scale up on heavy jobs when resources are insufficient', () => {
    const decision = decideScalingAction(
      baseInput({
        waitingJobs: 2,
        heavyWaitingJobs: 5,
        currentWorkerCount: 2,
        resources: scarceResources,
      }),
      defaultScalingPolicyConfig,
    );
    expect(decision.type).toBe('hold');
    expect(decision.reason).toContain('insufficient');
  });

  it('still respects the hard ceiling when triggered by heavy jobs', () => {
    const decision = decideScalingAction(
      baseInput({
        waitingJobs: 2,
        heavyWaitingJobs: 10,
        currentWorkerCount: defaultScalingPolicyConfig.maxWorkers,
      }),
      defaultScalingPolicyConfig,
    );
    expect(decision.type).not.toBe('scale-up');
  });
});

describe('decideScalingAction — real active-worker CPU load', () => {
  it('scales up when active workers are genuinely busy and something is waiting, even under the count threshold', () => {
    const decision = decideScalingAction(
      baseInput({
        waitingJobs: 1, // under scaleUpThreshold (3)
        averageActiveWorkerCpuLoadFraction: 0.95, // above busyWorkerCpuLoadThreshold (0.8)
        currentWorkerCount: 2,
      }),
      defaultScalingPolicyConfig,
    );
    expect(decision.type).toBe('scale-up');
    expect(decision.reason).toContain('CPU allotment');
  });

  it('does not scale up on worker load alone when nothing is waiting', () => {
    const decision = decideScalingAction(
      baseInput({
        waitingJobs: 0,
        averageActiveWorkerCpuLoadFraction: 0.99,
        currentWorkerCount: 2,
      }),
      defaultScalingPolicyConfig,
    );
    expect(decision.type).not.toBe('scale-up');
  });

  it('does not scale up when load is below the busy threshold', () => {
    const decision = decideScalingAction(
      baseInput({
        waitingJobs: 3, // neutral band, so no other signal masks the assertion
        averageActiveWorkerCpuLoadFraction: 0.5,
        currentWorkerCount: 2,
      }),
      defaultScalingPolicyConfig,
    );
    expect(decision.type).toBe('hold');
  });

  it('treats a null load reading as "no signal" rather than "busy"', () => {
    const decision = decideScalingAction(
      baseInput({
        waitingJobs: 3, // neutral band, so no other signal masks the assertion
        averageActiveWorkerCpuLoadFraction: null,
        currentWorkerCount: 2,
      }),
      defaultScalingPolicyConfig,
    );
    expect(decision.type).toBe('hold');
  });

  it('still refuses to scale up on real load when resources are insufficient', () => {
    const decision = decideScalingAction(
      baseInput({
        waitingJobs: 1,
        averageActiveWorkerCpuLoadFraction: 1,
        currentWorkerCount: 2,
        resources: scarceResources,
      }),
      defaultScalingPolicyConfig,
    );
    expect(decision.type).toBe('hold');
    expect(decision.reason).toContain('insufficient');
  });
});

describe('decideScalingAction — resource gating (the primary condition)', () => {
  it('refuses to scale up when the queue justifies it but resources are insufficient', () => {
    const decision = decideScalingAction(
      baseInput({
        waitingJobs: 10,
        currentWorkerCount: 2,
        resources: scarceResources,
      }),
      defaultScalingPolicyConfig,
    );
    expect(decision.type).toBe('hold');
    expect(decision.reason).toContain('insufficient');
  });

  it('scales up when the queue justifies it and resources are sufficient', () => {
    const decision = decideScalingAction(
      baseInput({
        waitingJobs: 10,
        currentWorkerCount: 2,
        resources: abundantResources,
      }),
      defaultScalingPolicyConfig,
    );
    expect(decision.type).toBe('scale-up');
  });

  it('never reports scale-up as the answer when resources are insufficient, no matter how deep the queue is', () => {
    const decision = decideScalingAction(
      baseInput({
        waitingJobs: 500,
        currentWorkerCount: 1,
        resources: scarceResources,
      }),
      defaultScalingPolicyConfig,
    );
    expect(decision.type).not.toBe('scale-up');
  });
});

describe('decideScalingAction — absolute ceiling of 10', () => {
  it('never scales up once at the configured maximum, even with a deep queue and abundant resources', () => {
    const decision = decideScalingAction(
      baseInput({
        waitingJobs: 1000,
        currentWorkerCount: defaultScalingPolicyConfig.maxWorkers,
        resources: abundantResources,
      }),
      defaultScalingPolicyConfig,
    );
    expect(decision.type).not.toBe('scale-up');
  });

  it('forces a scale-down if the fleet is somehow above the hard ceiling', () => {
    const decision = decideScalingAction(
      baseInput({
        waitingJobs: 1000,
        currentWorkerCount: defaultScalingPolicyConfig.maxWorkers + 1,
        resources: abundantResources,
      }),
      defaultScalingPolicyConfig,
    );
    expect(decision.type).toBe('scale-down');
  });

  it('bypasses the cooldown to correct a fleet above the hard ceiling', () => {
    const decision = decideScalingAction(
      baseInput({
        waitingJobs: 1000,
        currentWorkerCount: defaultScalingPolicyConfig.maxWorkers + 2,
        resources: abundantResources,
        msSinceLastScalingAction: 0,
      }),
      defaultScalingPolicyConfig,
    );
    expect(decision.type).toBe('scale-down');
  });

  it('the resource check alone would greenlight a scale-up that the hard ceiling still blocks', () => {
    // Demonstrates the ceiling is a backstop independent of (and stricter
    // than) the resource check: resources alone say "go", the ceiling says "no".
    const check = checkResourcesForOneMoreWorker(
      abundantResources,
      defaultScalingPolicyConfig,
    );
    expect(check.sufficient).toBe(true);
    const decision = decideScalingAction(
      baseInput({
        waitingJobs: 1000,
        currentWorkerCount: defaultScalingPolicyConfig.maxWorkers,
        resources: abundantResources,
      }),
      defaultScalingPolicyConfig,
    );
    expect(decision.type).toBe('hold');
  });
});

describe('clampMaxWorkers — absolute ceiling safety net', () => {
  it('leaves a ceiling at or below the absolute maximum untouched', () => {
    expect(clampMaxWorkers(5)).toBe(5);
    expect(clampMaxWorkers(ABSOLUTE_MAX_WORKERS_CEILING)).toBe(
      ABSOLUTE_MAX_WORKERS_CEILING,
    );
  });

  it('clamps a misconfigured ceiling above the absolute maximum down to it', () => {
    expect(clampMaxWorkers(999)).toBe(ABSOLUTE_MAX_WORKERS_CEILING);
  });
});

describe('decideScalingAction — floor', () => {
  it('never scales down once at the configured minimum, even with an empty queue', () => {
    const decision = decideScalingAction(
      baseInput({
        waitingJobs: 0,
        currentWorkerCount: defaultScalingPolicyConfig.minWorkers,
      }),
      defaultScalingPolicyConfig,
    );
    expect(decision.type).not.toBe('scale-down');
  });

  it('proposes a scale-up to restore the floor if the fleet ever dips below it', () => {
    const decision = decideScalingAction(
      baseInput({
        waitingJobs: 0,
        currentWorkerCount: 0,
        resources: abundantResources,
      }),
      defaultScalingPolicyConfig,
    );
    expect(decision.type).toBe('scale-up');
    expect(decision.reason).toContain('floor');
  });

  it('refuses to restore the floor when resources are insufficient, even though it is a safety-critical gap', () => {
    const decision = decideScalingAction(
      baseInput({
        waitingJobs: 0,
        currentWorkerCount: 0,
        resources: scarceResources,
      }),
      defaultScalingPolicyConfig,
    );
    expect(decision.type).toBe('hold');
    expect(decision.reason).toContain('insufficient');
  });

  it('respects a configured floor above the default of one', () => {
    const config: ScalingPolicyConfig = {
      ...defaultScalingPolicyConfig,
      minWorkers: 3,
    };
    const decision = decideScalingAction(
      baseInput({ waitingJobs: 0, currentWorkerCount: 2 }),
      config,
    );
    expect(decision.type).toBe('scale-up');
  });
});

describe('decideScalingAction — anti-flapping cooldown', () => {
  it('holds when a previous scaling action happened more recently than the cooldown window', () => {
    const decision = decideScalingAction(
      baseInput({
        waitingJobs: 10,
        currentWorkerCount: 2,
        msSinceLastScalingAction: 5_000,
      }),
      defaultScalingPolicyConfig,
    );
    expect(decision.type).toBe('hold');
    expect(decision.reason).toContain('cooldown');
  });

  it('acts again once the cooldown window has fully elapsed', () => {
    const decision = decideScalingAction(
      baseInput({
        waitingJobs: 10,
        currentWorkerCount: 2,
        msSinceLastScalingAction: defaultScalingPolicyConfig.cooldownMs,
      }),
      defaultScalingPolicyConfig,
    );
    expect(decision.type).toBe('scale-up');
  });

  it('is never gated by cooldown on the very first decision (no prior action yet)', () => {
    const decision = decideScalingAction(
      baseInput({
        waitingJobs: 10,
        currentWorkerCount: 2,
        msSinceLastScalingAction: null,
      }),
      defaultScalingPolicyConfig,
    );
    expect(decision.type).toBe('scale-up');
  });

  it('prevents rapid oscillation between scale-up and scale-down on transient fluctuation', () => {
    const config: ScalingPolicyConfig = {
      ...defaultScalingPolicyConfig,
      cooldownMs: 60_000,
    };
    const scaleUp = decideScalingAction(
      baseInput({ waitingJobs: 10, currentWorkerCount: 2 }),
      config,
    );
    expect(scaleUp.type).toBe('scale-up');
    // Immediately after, demand drops — but cooldown must hold the line.
    const wouldFlap = decideScalingAction(
      baseInput({
        waitingJobs: 0,
        currentWorkerCount: 3,
        msSinceLastScalingAction: 1_000,
      }),
      config,
    );
    expect(wouldFlap.type).toBe('hold');
  });
});
