import { Worker, type Job } from 'bullmq';
import { compileSnapshot } from './compiler';
import type { CompilationResult, Snapshot } from './model';
import { decryptString } from '../services/dataProtection';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const queueName = process.env.COMPILATION_QUEUE_NAME || 'frelated-latex';
const serviceUrl =
  process.env.COMPILATION_SERVICE_URL || 'http://localhost:3200';
const workerToken =
  process.env.COMPILATION_WORKER_TOKEN || 'frelated-dev-worker-token-change-me';

interface JobData {
  projectId: string;
  hash: string;
  snapshot: string;
}

const decodeSnapshot = (value: string, projectId: string): Snapshot =>
  JSON.parse(
    decryptString(JSON.parse(value), 'compilation', projectId),
  ) as Snapshot;

async function serviceRequest(
  path: string,
  init: RequestInit = {},
  acceptedStatuses: number[] = [],
) {
  const response = await fetch(`${serviceUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${workerToken}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (!response.ok && !acceptedStatuses.includes(response.status)) {
    throw new Error(`Compilation queue service returned ${response.status}.`);
  }
  return response;
}

async function isCurrent(job: Job<JobData>): Promise<boolean> {
  const response = await serviceRequest(
    `/internal/jobs/${encodeURIComponent(job.id!)}/current?projectId=${encodeURIComponent(job.data.projectId)}`,
  );
  return ((await response.json()) as { current: boolean }).current;
}

async function report(
  job: Job<JobData>,
  result: CompilationResult,
  output: { pdf?: string; synctex?: string } = {},
) {
  await serviceRequest(
    `/internal/jobs/${encodeURIComponent(job.id!)}/result`,
    {
      method: 'POST',
      body: JSON.stringify({
        projectId: job.data.projectId,
        hash: job.data.hash,
        result,
        pdf: output.pdf,
        synctex: output.synctex,
        snapshot: job.data.snapshot,
      }),
    },
    // A newer revision may supersede this job while TeX is running. The
    // queue service rejects that stale result without making the job fail.
    [409],
  );
}

const connectionUrl = new URL(redisUrl);
const worker = new Worker<JobData>(
  queueName,
  async (job) => {
    // Superseded jobs never spend CPU on an obsolete revision.
    if (!(await isCurrent(job))) return;
    const { result, pdf, synctex } = await compileSnapshot(
      decodeSnapshot(job.data.snapshot, job.data.projectId),
    );
    await report(job, result, { pdf, synctex });
  },
  {
    connection: {
      host: connectionUrl.hostname,
      port: Number(connectionUrl.port) || 6379,
      username: connectionUrl.username || undefined,
      password: connectionUrl.password || undefined,
      db: Number(connectionUrl.pathname.slice(1)) || 0,
      ...(redisUrl.startsWith('rediss:') ? { tls: {} } : {}),
    },
    concurrency: 1,
  },
);

worker.on('error', (error) => console.error('[worker]', error.message));
worker.on('failed', (job, error) => {
  if (!job) return;
  const result: CompilationResult = {
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
  void report(job, result).catch((reportError) =>
    console.error('[worker report failed]', reportError),
  );
  console.error('[worker failed]', error.message);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    void worker.close();
  });
}
console.log('LaTeX worker ready (pdfLaTeX, XeLaTeX, LuaLaTeX, BibTeX/Biber).');
