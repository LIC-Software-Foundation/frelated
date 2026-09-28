/**
 * Ports (in the hexagonal-architecture sense) that the scaling logic depends
 * on. Nothing in `domain/` or `services/` may import a concrete queue client
 * (BullMQ, amqplib, ...) or the Docker API directly — only these interfaces.
 *
 * This is what lets the underlying job queue change one day without
 * touching a single line of decision logic (Dependency Inversion /
 * Open-Closed): a new queue technology only needs a new adapter that
 * implements `QueueDepthProvider`.
 */

/**
 * A snapshot of how backed up the compilation queue is. Kept intentionally
 * small: two numbers, both about "how much work is piling up", never job
 * payloads or queue administration.
 */
export interface QueueSnapshot {
  /** Number of jobs waiting for a free worker right now. */
  waitingCount: number;
  /**
   * Of those, how many look like "heavy" jobs — a proxy signal, not a
   * precise measurement (see `bullMqQueueDepthProvider.ts` for how it's
   * derived). Lets the decision react to a couple of large jobs piling up
   * even while the raw count stays under the normal threshold.
   */
  heavyWaitingCount: number;
}

/**
 * Reads how backed up the compilation queue is. Deliberately the smallest
 * possible interface (Interface Segregation) — the scaling decision only
 * ever needs this one snapshot, never job payloads, retries, or queue
 * administration.
 */
export interface QueueDepthProvider {
  getQueueSnapshot(): Promise<QueueSnapshot>;
}

/**
 * A snapshot of the host machine's spare capacity, expressed independently
 * of how it was measured (reading /proc, calling the Docker API, a cloud
 * metrics endpoint, ...) so any implementation can substitute another
 * (Liskov Substitution) without the caller noticing.
 */
export interface SystemResources {
  /** Total physical memory of the host, in bytes. */
  totalMemoryBytes: number;
  /**
   * Memory the host can hand out to a new process right now, in bytes.
   * Implementations should prefer an "available" estimate (reclaimable
   * caches counted as free) over a raw "free" one, which tends to under-
   * report on Linux hosts with a warm page cache.
   */
  availableMemoryBytes: number;
  /** Number of logical CPUs on the host. */
  cpuCount: number;
  /**
   * Current normalized CPU load, as a fraction of total capacity (1.0 means
   * every logical CPU is fully busy on average). Can exceed 1.0 when the
   * host is overcommitted.
   */
  cpuLoadFraction: number;
}

export interface SystemResourceMonitor {
  /** Reads the host's current spare capacity. */
  getResources(): Promise<SystemResources>;
}

/**
 * Executes scaling decisions by creating or destroying compilation-worker
 * containers. This is the only component allowed to talk to Docker — the
 * decision logic calls it but never knows how it is implemented.
 */
export interface WorkerOrchestrator {
  /** Number of compilation-worker containers currently active (running). */
  getActiveWorkerCount(): Promise<number>;
  /**
   * Average real CPU load of currently active worker containers, as a
   * fraction of each worker's own CPU allotment (1.0 = pegged at its own
   * limit). `null` when it cannot be determined (no active workers, or
   * stats unavailable) — the decision treats that as "no signal", not as
   * "idle" or "busy".
   */
  getAverageActiveWorkerCpuLoadFraction(): Promise<number | null>;
  /** Creates and starts one additional compilation-worker container. */
  scaleUp(): Promise<void>;
  /**
   * Gracefully stops and removes one compilation-worker container that this
   * orchestrator created. Must never remove a worker it does not manage
   * (e.g. the baseline instance declared directly in docker-compose.yml),
   * so the floor guaranteed by that static declaration is never at risk.
   */
  scaleDown(): Promise<void>;
}
