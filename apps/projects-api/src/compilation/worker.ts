import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { compileSnapshot } from './compiler';
import { decode, encode, key, queueName, redisUrl } from './queue';
import type { Snapshot } from './model';

const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
redis.on('error', (error) => console.error('[worker redis]', error.message));
const worker = new Worker(
  queueName,
  async (job) => {
    const { projectId, hash, snapshot } = job.data as {
      projectId: string;
      hash: string;
      snapshot: string;
    };
    const stateKey = key(projectId);
    // Superseded jobs never spend CPU on an obsolete revision.
    if ((await redis.hget(stateKey, 'jobId')) !== job.id) return;
    const { result, pdf, synctex } = await compileSnapshot(
      decode<Snapshot>(snapshot, projectId),
    );
    // Compare-and-set prevents a slower old job from overwriting a newer result.
    await redis.eval(
      `
    if redis.call('HGET', KEYS[1], 'jobId') ~= ARGV[1] then return 0 end
    redis.call('HSET', KEYS[1], 'status', ARGV[2], 'result', ARGV[3])
    if ARGV[2] == 'success' and ARGV[4] ~= '' and ARGV[5] ~= '' then
      redis.call('HSET', KEYS[1], 'pdf', ARGV[4], 'pdfJobId', ARGV[1], 'pdfHash', ARGV[6], 'synctex', ARGV[5], 'synctexJobId', ARGV[1], 'synctexHash', ARGV[6], 'synctexSnapshot', ARGV[7])
    end
    redis.call('PUBLISH', 'frelated-compilation-events', ARGV[8])
    return 1
  `,
      1,
      stateKey,
      job.id!,
      result.status,
      encode(result, projectId),
      pdf ? encode(pdf, projectId) : '',
      synctex ? encode(synctex, projectId) : '',
      hash,
      snapshot,
      projectId,
    );
  },
  {
    connection: {
      host: new URL(redisUrl).hostname,
      port: Number(new URL(redisUrl).port) || 6379,
      username: new URL(redisUrl).username || undefined,
      password: new URL(redisUrl).password || undefined,
      db: Number(new URL(redisUrl).pathname.slice(1)) || 0,
      ...(redisUrl.startsWith('rediss:') ? { tls: {} } : {}),
    },
    concurrency: 1,
  },
);
worker.on('error', (error) => console.error('[worker]', error.message));
worker.on('failed', (job, error) => {
  if (!job) return;
  const projectId = job.data.projectId as string;
  const result = {
    status: 'error',
    logs: [
      {
        level: 'error',
        message: 'Le worker a interrompu la compilation. Relancez-la.',
      },
    ],
    compiledAt: new Date().toISOString(),
    durationMs: 0,
  };
  void redis
    .eval(
      `if redis.call('HGET', KEYS[1], 'jobId') == ARGV[1] then redis.call('HSET', KEYS[1], 'status', 'error', 'result', ARGV[2]); redis.call('PUBLISH', 'frelated-compilation-events', ARGV[3]); end`,
      1,
      key(projectId),
      job.id!,
      encode(result, projectId),
      projectId,
    )
    .catch(console.error);
  console.error('[worker failed]', error.message);
});
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    void worker.close().then(() => redis.quit());
  });
console.log('LaTeX worker ready (pdfLaTeX, XeLaTeX, LuaLaTeX, BibTeX/Biber).');
