import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from './config.js';
import { decode, encode } from './crypto.js';
import {
  settingsSchema,
  type CompilationResult,
  type Settings,
  type Snapshot,
} from './contracts.js';

export const stateKey = (projectId: string) => `compilation:${projectId}`;
export const eventChannel = 'frelated-compilation-events';

export interface CompilationState
  extends Omit<Partial<CompilationResult>, 'status'> {
  status: 'idle' | 'compiling' | 'success' | 'error';
  jobId?: string;
  revision: number;
  pdfJobId?: string;
  synctexJobId?: string;
  isPdfStale: boolean;
  settings: Settings;
}

export class CompilationStore {
  readonly redis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    commandTimeout: 5000,
  });
  readonly queue = new Queue(config.queueName, {
    connection: this.redis,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { age: 3600, count: 100 },
      removeOnFail: { age: 86400, count: 100 },
    },
  });

  constructor() {
    this.redis.on('error', (error) =>
      console.error('[compilation queue redis]', error.message),
    );
    this.queue.on('error', (error) =>
      console.error('[compilation queue]', error.message),
    );
  }

  async readSettings(projectId: string): Promise<Settings> {
    const raw = await this.redis.hget(stateKey(projectId), 'settings');
    return settingsSchema.parse(raw ? decode(raw, projectId) : {});
  }

  async writeSettings(projectId: string, settings: Settings) {
    await this.redis.hset(
      stateKey(projectId),
      'settings',
      encode(settings, projectId),
    );
    await this.publish(projectId);
    return this.readState(projectId);
  }

  async readState(projectId: string): Promise<CompilationState> {
    const fields = [
      'result',
      'status',
      'jobId',
      'revision',
      'pdfJobId',
      'synctexJobId',
      'hash',
      'pdfHash',
    ];
    const values = await this.redis.hmget(stateKey(projectId), ...fields);
    const data = Object.fromEntries(
      fields.map((field, index) => [field, values[index]]),
    );
    const result = data.result
      ? decode<CompilationResult>(data.result, projectId)
      : undefined;
    return {
      ...(result ?? {}),
      logs: result?.logs ?? [],
      status:
        data.status === 'compiling' ||
        data.status === 'success' ||
        data.status === 'error'
          ? data.status
          : 'idle',
      jobId: data.jobId ?? undefined,
      revision: Number(data.revision || 0),
      pdfJobId: data.pdfJobId ?? undefined,
      synctexJobId: data.synctexJobId ?? undefined,
      isPdfStale: Boolean(
        data.pdfHash && data.hash && data.pdfHash !== data.hash,
      ),
      settings: await this.readSettings(projectId),
    };
  }

  async submit(
    projectId: string,
    hash: string,
    snapshot: Snapshot,
    onlyIfChanged: boolean,
  ): Promise<{ state: CompilationState; accepted: boolean }> {
    const lockValue = randomUUID();
    const lockKey = `${stateKey(projectId)}:lock`;
    if (!(await this.redis.set(lockKey, lockValue, 'PX', 15000, 'NX'))) {
      throw new Error('SUBMISSION_LOCKED');
    }
    try {
      const [status, previousHash, pdfHash] = await this.redis.hmget(
        stateKey(projectId),
        'status',
        'hash',
        'pdfHash',
      );
      if (
        (status === 'compiling' && previousHash === hash) ||
        (onlyIfChanged && status === 'success' && pdfHash === hash)
      ) {
        return { state: await this.readState(projectId), accepted: false };
      }
      const jobId = randomUUID();
      const revision = await this.redis.incr(`${stateKey(projectId)}:sequence`);
      await this.redis.hset(
        stateKey(projectId),
        'jobId',
        jobId,
        'hash',
        hash,
        'status',
        'compiling',
        'revision',
        revision,
      );
      await this.redis.hdel(stateKey(projectId), 'result');
      try {
        await this.queue.add(
          'compile',
          { projectId, hash, snapshot: encode(snapshot, projectId) },
          { jobId },
        );
      } catch (error) {
        const result = {
          status: 'error' as const,
          logs: [
            {
              level: 'error' as const,
              message: 'La mise en file a échoué. Réessayez.',
            },
          ],
          compiledAt: new Date().toISOString(),
          durationMs: 0,
        };
        await this.redis.hset(
          stateKey(projectId),
          'status',
          'error',
          'result',
          encode(result, projectId),
        );
        await this.publish(projectId);
        throw error;
      }
      await this.redis.expire(stateKey(projectId), 30 * 86400);
      await this.publish(projectId);
      return { state: await this.readState(projectId), accepted: true };
    } finally {
      await this.redis.eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end",
        1,
        lockKey,
        lockValue,
      );
    }
  }

  async saveResult(input: {
    projectId: string;
    jobId: string;
    hash: string;
    result: CompilationResult;
    pdf?: string;
    synctex?: string;
    snapshot: string;
  }): Promise<boolean> {
    const saved = await this.redis.eval(
      `
      if redis.call('HGET', KEYS[1], 'jobId') ~= ARGV[1] then return 0 end
      redis.call('HSET', KEYS[1], 'status', ARGV[2], 'result', ARGV[3])
      if ARGV[2] == 'success' and ARGV[4] ~= '' and ARGV[5] ~= '' then
        redis.call('HSET', KEYS[1], 'pdf', ARGV[4], 'pdfJobId', ARGV[1], 'pdfHash', ARGV[6], 'synctex', ARGV[5], 'synctexJobId', ARGV[1], 'synctexHash', ARGV[6], 'synctexSnapshot', ARGV[7])
      end
      redis.call('PUBLISH', ARGV[8], ARGV[9])
      return 1
      `,
      1,
      stateKey(input.projectId),
      input.jobId,
      input.result.status,
      encode(input.result, input.projectId),
      input.pdf ? encode(input.pdf, input.projectId) : '',
      input.synctex ? encode(input.synctex, input.projectId) : '',
      input.hash,
      input.snapshot,
      eventChannel,
      input.projectId,
    );
    return saved === 1;
  }

  async isCurrentJob(projectId: string, jobId: string): Promise<boolean> {
    return (await this.redis.hget(stateKey(projectId), 'jobId')) === jobId;
  }

  async readPdf(projectId: string): Promise<Buffer | null> {
    const value = await this.redis.hget(stateKey(projectId), 'pdf');
    return value
      ? Buffer.from(decode<string>(value, projectId), 'base64')
      : null;
  }

  async readSyncArtifact(projectId: string) {
    const fields = [
      'pdf',
      'pdfJobId',
      'pdfHash',
      'synctex',
      'synctexJobId',
      'synctexHash',
      'synctexSnapshot',
      'hash',
    ];
    const values = await this.redis.hmget(stateKey(projectId), ...fields);
    const data = Object.fromEntries(
      fields.map((field, index) => [field, values[index]]),
    );
    if (
      !data.pdf ||
      !data.synctex ||
      !data.synctexSnapshot ||
      !data.synctexHash ||
      !data.pdfJobId ||
      data.pdfJobId !== data.synctexJobId ||
      data.pdfHash !== data.synctexHash
    ) {
      return null;
    }
    return {
      jobId: data.pdfJobId,
      pdf: decode<string>(data.pdf, projectId),
      synctex: decode<string>(data.synctex, projectId),
      snapshot: decode<Snapshot>(data.synctexSnapshot, projectId),
      hash: data.synctexHash,
      stale: Boolean(data.hash && data.pdfHash !== data.hash),
    };
  }

  async metrics() {
    const [waitingCount, activeCount, delayedCount, waiting] =
      await Promise.all([
        this.queue.getWaitingCount(),
        this.queue.getActiveCount(),
        this.queue.getDelayedCount(),
        this.queue.getWaiting(0, 9),
      ]);
    const heavyWaitingCount = waiting.filter(
      (job) =>
        Buffer.byteLength(JSON.stringify(job.data), 'utf8') >=
        config.heavyJobPayloadThresholdBytes,
    ).length;
    const oldestTimestamp = waiting.reduce(
      (oldest, job) => Math.min(oldest, job.timestamp),
      Number.POSITIVE_INFINITY,
    );
    return {
      queue: config.queueName,
      waitingCount,
      activeCount,
      delayedCount,
      heavyWaitingCount,
      oldestWaitingJobAgeMs: Number.isFinite(oldestTimestamp)
        ? Math.max(0, Date.now() - oldestTimestamp)
        : 0,
      available: true,
    };
  }

  async remove(projectId: string) {
    await this.redis.del(
      stateKey(projectId),
      `${stateKey(projectId)}:sequence`,
      `${stateKey(projectId)}:lock`,
    );
    await this.publish(projectId);
  }

  async publish(projectId: string) {
    await this.redis.publish(eventChannel, projectId);
  }

  async close() {
    await this.queue.close();
    this.redis.disconnect();
  }
}
