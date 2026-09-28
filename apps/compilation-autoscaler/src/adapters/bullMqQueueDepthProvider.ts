import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { QueueDepthProvider, QueueSnapshot } from '../domain/ports.js';
import type { Logger } from '../logging/logger.js';

/**
 * How many of the oldest waiting jobs to inspect when looking for "heavy"
 * ones. Bounded deliberately: fetching a job's `data` field pulls its full
 * (still-encrypted) payload over the wire, which can be several MB for a
 * complex document. Capping at this many — comfortably above
 * `ABSOLUTE_MAX_WORKERS_CEILING` — keeps the cost of each poll bounded
 * without ever missing a job that could realistically still receive a
 * worker.
 */
const HEAVY_JOB_SAMPLE_LIMIT = 10;

/**
 * Concrete `QueueDepthProvider` for the compilation queue as it exists
 * today: BullMQ backed by Redis (see
 * apps/projects-api/src/compilation/queue.ts). This is the ONLY file in
 * this service allowed to know that. If the queue technology changes one
 * day, only this adapter needs to be replaced — the decision logic in
 * `domain/scalingPolicy.ts` and the orchestration in
 * `services/autoscalerService.ts` stay untouched.
 *
 * Deliberately does not import anything from `apps/projects-api`: reading
 * a waiting-job count needs neither the encrypted job payload format nor
 * the settings schema used there, only the queue's name and a Redis
 * connection. `queueName` must stay in sync with the real queue's name
 * (kept as a plain, documented constant/env value rather than a source
 * import, to avoid coupling this app's build to projects-api's source
 * tree for a single string).
 */
export class BullMqQueueDepthProvider implements QueueDepthProvider {
  private readonly connection: Redis;
  private readonly queue: Queue;

  constructor(
    redisUrl: string,
    queueName: string,
    /**
     * A waiting job is considered "heavy" once its (still-encrypted)
     * payload exceeds this many bytes — a proxy for "this document embeds
     * a lot of content" (images, mainly), not a precise measurement of
     * compilation cost. A small document with a CPU-heavy TikZ diagram
     * would not be caught by this signal; see
     * `WorkerOrchestrator.getAverageActiveWorkerCpuLoadFraction` for a
     * complementary signal based on real observed load instead of job
     * content.
     */
    private readonly heavyJobPayloadThresholdBytes: number,
    private readonly logger: Logger,
  ) {
    this.connection = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      commandTimeout: 5000,
      lazyConnect: false,
    });
    this.connection.on('error', (error) =>
      this.logger.error('redis connection error', error),
    );
    this.queue = new Queue(queueName, { connection: this.connection });
    this.queue.on('error', (error) => this.logger.error('queue error', error));
  }

  async getQueueSnapshot(): Promise<QueueSnapshot> {
    // Waiting-or-paused jobs are exactly the jobs a worker hasn't started
    // on yet — the right signal for "is anything backed up?".
    const [waitingCount, oldestWaiting] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getWaiting(0, HEAVY_JOB_SAMPLE_LIMIT - 1),
    ]);
    const heavyWaitingCount = oldestWaiting.filter(
      (job) =>
        Buffer.byteLength(JSON.stringify(job.data), 'utf8') >=
        this.heavyJobPayloadThresholdBytes,
    ).length;
    return { waitingCount, heavyWaitingCount };
  }

  async close(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
