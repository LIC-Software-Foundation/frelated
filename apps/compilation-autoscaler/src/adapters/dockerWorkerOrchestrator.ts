import { randomUUID } from 'node:crypto';
import Docker from 'dockerode';
import type { WorkerOrchestrator } from '../domain/ports.js';
import type { Logger } from '../logging/logger.js';

// dockerode's types are exported as `export =` (a namespace merged onto the
// default export), so nested types are reached as `Docker.X`, not via named
// imports.
type ContainerInfo = Docker.ContainerInfo;

/** Label compose applies automatically to containers it creates. */
const COMPOSE_SERVICE_LABEL = 'com.docker.compose.service';
/** Compose service name of the always-on baseline worker (see docker-compose.yml). */
const BASELINE_SERVICE_NAME = 'compilation-worker';
/** Label this orchestrator applies to (and only to) the containers it creates. */
const MANAGED_BY_LABEL = 'com.frelated.managed-by';
const MANAGED_BY_VALUE = 'compilation-autoscaler';

/**
 * Only the CPU fields `computeContainerCpuLoadFraction` actually reads —
 * deliberately narrower than dockerode's full `CPUStats` (which also
 * requires `percpu_usage`, `throttling_data`, etc.) so a plain fake object
 * satisfies it in tests. A real `ContainerStats` value has strictly more
 * fields than this, so it is always structurally compatible.
 */
interface MinimalCpuStats {
  cpu_usage: { total_usage: number };
  system_cpu_usage?: number;
  online_cpus?: number;
}

/**
 * Computes one container's CPU usage as a fraction of its own CPU
 * allotment (1.0 = pegged at its own limit), from a single non-streaming
 * Docker stats snapshot. Docker's non-streaming stats response already
 * carries both the current sample (`cpu_stats`) and the previous one
 * (`precpu_stats`) it collected in the background, so a single call gives
 * an instant rate without this code needing to sample twice itself.
 *
 * Every compilation-worker this service creates (and the compose-declared
 * baseline) is capped at exactly 1 CPU (`NanoCpus: 1_000_000_000` /
 * `cpus: 1`), so the standard Docker CPU-percent formula — which is
 * normally relative to the *host's* total CPUs — already expresses "how
 * much of this container's own 1-CPU cap it is using" once read as a
 * fraction instead of a host-wide percentage.
 *
 * Pure and exported specifically so it can be unit tested with a fake
 * stats object, without a real Docker connection.
 */
export function computeContainerCpuLoadFraction(stats: {
  cpu_stats: MinimalCpuStats;
  precpu_stats: MinimalCpuStats;
}): number | null {
  const cpuDelta =
    stats.cpu_stats.cpu_usage.total_usage -
    stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta =
    (stats.cpu_stats.system_cpu_usage ?? 0) -
    (stats.precpu_stats.system_cpu_usage ?? 0);
  // A non-positive system delta means there is no valid previous sample yet
  // (e.g. right after the container started) — no reading is possible, not
  // a reading of zero.
  if (systemDelta <= 0 || cpuDelta < 0) return null;
  const onlineCpus = stats.cpu_stats.online_cpus || 1;
  return (cpuDelta / systemDelta) * onlineCpus;
}

export interface DockerWorkerOrchestratorConfig {
  /** Path to the Docker daemon's Unix socket, mounted into this container. */
  socketPath: string;
  /** Pre-built compilation-worker image to start new containers from. */
  image: string;
  /** Docker network to attach new workers to (must match docker-compose.yml). */
  network: string;
  redisUrl: string;
  authSecret: string;
  dataEncryptionKey: string;
  compilationTimeoutMs: number;
  /**
   * Container resource limits applied to every worker this orchestrator
   * creates. Read from the SAME environment variables as the
   * compose-declared baseline worker's own limits in docker-compose.yml
   * (`COMPILATION_WORKER_MEMORY_MB`, `_CPUS`, `_PIDS_LIMIT`,
   * `_TMPFS_SIZE_MB`) — one real source of truth instead of the same
   * numbers hard-coded twice and free to drift apart unnoticed.
   */
  workerMemoryBytes: number;
  workerNanoCpus: number;
  workerPidsLimit: number;
  workerTmpfsSizeMb: number;
  /** Seconds Docker waits after SIGTERM before force-killing on scale-down. */
  gracefulStopTimeoutSeconds: number;
}

/**
 * Concrete `WorkerOrchestrator`: creates and destroys compilation-worker
 * containers directly on the Docker host, via the Docker Engine API. This
 * is the only component in the service that touches Docker.
 *
 * Design note — coexistence with the compose-declared baseline worker:
 * docker-compose.yml declares one `compilation-worker` service with
 * `restart: unless-stopped`, which is what actually guarantees the "never
 * fewer than 1 worker" floor even if this whole autoscaler process is down.
 * This orchestrator never touches that container — only ones it created
 * itself, identified by the `com.frelated.managed-by` label — so it can
 * never fight compose's restart policy or accidentally strand the fleet
 * below the floor. `getActiveWorkerCount()` still counts the compose
 * baseline alongside its own containers, so the hard ceiling is enforced
 * against the *real* total, including containers created outside this
 * service (e.g. a manual `docker compose up --scale`).
 *
 * Resource limits mirror the compose-declared baseline worker's
 * (mem_limit, cpus, pids_limit, cap_drop/add, read_only, tmpfs, init) —
 * keep the two in sync if one changes.
 */
export class DockerWorkerOrchestrator implements WorkerOrchestrator {
  private readonly docker: Docker;

  constructor(
    private readonly config: DockerWorkerOrchestratorConfig,
    private readonly logger: Logger,
  ) {
    this.docker = new Docker({ socketPath: config.socketPath });
  }

  /**
   * Baseline (compose-managed) + self-managed worker containers currently
   * running.
   *
   * Deliberately two separate `listContainers` calls, not one call with
   * both label values in the same `filters.label` array. Docker's label
   * filter ANDs multiple values together (a container must carry every
   * listed label to match) rather than ORing them — the opposite of what
   * a single combined call would need here, since a normal baseline
   * container only ever carries the compose label, never the
   * `managed-by` one. A single-call version silently drops the baseline
   * entirely; only a container that happens to carry both labels (which
   * does not happen in normal operation) would ever be counted.
   * Results are de-duplicated by container id in case one ever does carry
   * both.
   */
  private async listActiveWorkerContainers(): Promise<ContainerInfo[]> {
    const [baseline, managed] = await Promise.all([
      this.docker.listContainers({
        all: false,
        filters: {
          label: [`${COMPOSE_SERVICE_LABEL}=${BASELINE_SERVICE_NAME}`],
        },
      }),
      this.docker.listContainers({
        all: false,
        filters: { label: [`${MANAGED_BY_LABEL}=${MANAGED_BY_VALUE}`] },
      }),
    ]);
    const byId = new Map<string, ContainerInfo>();
    for (const container of [...baseline, ...managed])
      byId.set(container.Id, container);
    return [...byId.values()];
  }

  async getActiveWorkerCount(): Promise<number> {
    const containers = await this.listActiveWorkerContainers();
    return containers.length;
  }

  async getAverageActiveWorkerCpuLoadFraction(): Promise<number | null> {
    const containers = await this.listActiveWorkerContainers();
    const readings: number[] = [];
    for (const info of containers) {
      try {
        const stats = await this.docker
          .getContainer(info.Id)
          .stats({ stream: false });
        const fraction = computeContainerCpuLoadFraction(stats);
        if (fraction !== null) readings.push(fraction);
      } catch (error) {
        this.logger.warn(
          `failed to read CPU stats for worker ${info.Id.slice(0, 12)}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    if (readings.length === 0) return null;
    return readings.reduce((sum, value) => sum + value, 0) / readings.length;
  }

  async scaleUp(): Promise<void> {
    const name = `frelated-compilation-worker-auto-${randomUUID().slice(0, 8)}`;
    const container = await this.docker.createContainer({
      name,
      Image: this.config.image,
      Env: [
        `REDIS_URL=${this.config.redisUrl}`,
        `AUTH_SECRET=${this.config.authSecret}`,
        `DATA_ENCRYPTION_KEY=${this.config.dataEncryptionKey}`,
        `COMPILATION_TIMEOUT_MS=${this.config.compilationTimeoutMs}`,
      ],
      Labels: {
        [MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
        'com.frelated.role': BASELINE_SERVICE_NAME,
      },
      HostConfig: {
        NetworkMode: this.config.network,
        RestartPolicy: { Name: 'no' },
        Init: true,
        ReadonlyRootfs: true,
        SecurityOpt: ['no-new-privileges:true'],
        CapDrop: ['ALL'],
        CapAdd: ['SETUID', 'SETGID', 'CHOWN', 'DAC_OVERRIDE'],
        Memory: 768 * 1024 * 1024,
        NanoCpus: 1_000_000_000,
        PidsLimit: 128,
        Tmpfs: { '/tmp': 'size=384m,mode=1777' },
      },
    });
    await container.start();
    this.logger.info(
      `created and started worker container ${name} (${container.id.slice(0, 12)})`,
    );
  }

  async scaleDown(): Promise<void> {
    const managedContainers = await this.docker.listContainers({
      all: false,
      filters: { label: [`${MANAGED_BY_LABEL}=${MANAGED_BY_VALUE}`] },
    });
    if (managedContainers.length === 0) {
      this.logger.warn(
        'scale-down requested but no autoscaler-managed worker is running to remove; the floor is already covered by the baseline compilation-worker service alone',
      );
      return;
    }
    // Workers are stateless and interchangeable (BullMQ concurrency 1, no
    // per-worker state), so which one is removed is arbitrary; picking the
    // most recently created one is simply a deterministic, easy-to-reason-
    // about choice.
    const target = managedContainers.reduce((newest, candidate) =>
      candidate.Created > newest.Created ? candidate : newest,
    );
    const container = this.docker.getContainer(target.Id);
    this.logger.info(
      `stopping worker container ${target.Names[0] ?? target.Id.slice(0, 12)}, allowing up to ${this.config.gracefulStopTimeoutSeconds}s for an in-flight compilation to finish gracefully`,
    );
    await container.stop({ t: this.config.gracefulStopTimeoutSeconds });
    await container.remove();
  }
}
