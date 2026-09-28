import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clampMaxWorkers } from '../domain/scalingPolicy.js';

// Resolve paths relative to this file's location so they are correct
// regardless of the working directory the process is started from.
// src/config/env.ts -> up 2 levels -> APP_DIR, then up 2 more -> ROOT_DIR.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_DIR = path.resolve(__dirname, '../..');
const ROOT_DIR = path.resolve(APP_DIR, '../..');

const parseEnvValue = (value: string) => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const loadEnvFile = (filePath: string) => {
  if (!fs.existsSync(filePath)) return;
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    if (!(key in process.env)) {
      process.env[key] = parseEnvValue(line.slice(separatorIndex + 1));
    }
  }
};

loadEnvFile(path.join(APP_DIR, '.env'));
loadEnvFile(path.join(APP_DIR, 'src/.env'));

const numberOr = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && value !== undefined && value !== ''
    ? parsed
    : fallback;
};

export const env = {
  rootDir: ROOT_DIR,
  appDir: APP_DIR,

  // Health/status HTTP server.
  port: numberOr(process.env.PORT, 3100),
  host: process.env.HOST || '0.0.0.0',

  // The queue this service reads job counts from. Only the concrete BullMQ
  // adapter (src/adapters/bullMqQueueDepthProvider.ts) knows about these —
  // the decision logic never sees them.
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  // Must match `queueName` in apps/projects-api/src/compilation/queue.ts.
  // Kept as its own env var (rather than importing that module) so the
  // autoscaler's only real coupling to the current queue technology is this
  // one adapter, easily swapped if the queue changes.
  compilationQueueName: process.env.COMPILATION_QUEUE_NAME || 'frelated-latex',

  // A waiting job whose (still-encrypted) payload is at least this big is
  // considered "heavy" — a proxy for embedded content (mainly images), not
  // a precise measurement. Read directly by the BullMQ adapter, never by
  // the decision logic itself.
  heavyJobPayloadThresholdBytes:
    numberOr(process.env.HEAVY_JOB_PAYLOAD_THRESHOLD_MB, 3) * 1024 * 1024,

  // Docker orchestration of compilation-worker containers.
  dockerSocketPath: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock',
  compilationWorkerImage:
    process.env.COMPILATION_WORKER_IMAGE || 'frelated-compilation-worker',
  dockerNetwork: process.env.COMPILATION_WORKER_NETWORK || 'frelated-network',
  // Passed through to workers this service creates, identical to the
  // baseline compilation-worker service declared in docker-compose.yml.
  workerAuthSecret:
    process.env.AUTH_SECRET || 'frelated-dev-auth-secret-change-me',
  workerDataEncryptionKey: process.env.DATA_ENCRYPTION_KEY || '',
  workerRedisUrl: process.env.REDIS_URL || 'redis://redis:6379',
  workerCompilationTimeoutMs: numberOr(
    process.env.COMPILATION_TIMEOUT_MS,
    120_000,
  ),
  // Seconds Docker waits after SIGTERM before force-killing a worker being
  // scaled down. Long enough for BullMQ's graceful Worker#close() to let an
  // in-flight compilation finish rather than losing the job.
  workerGracefulStopTimeoutSeconds: Math.ceil(
    numberOr(process.env.COMPILATION_TIMEOUT_MS, 120_000) / 1000 + 10,
  ),

  // Scaling loop cadence.
  pollIntervalMs: Math.max(1000, numberOr(process.env.POLL_INTERVAL_MS, 5_000)),

  // Scaling policy thresholds — see src/domain/scalingPolicy.ts for how
  // these combine. maxWorkers is clamped so no misconfiguration can push it
  // past the absolute safety ceiling.
  scaleUpThreshold: numberOr(process.env.SCALE_UP_THRESHOLD, 3),
  scaleDownThreshold: numberOr(process.env.SCALE_DOWN_THRESHOLD, 3),
  minWorkers: Math.max(0, numberOr(process.env.MIN_WORKERS, 1)),
  maxWorkers: clampMaxWorkers(numberOr(process.env.MAX_WORKERS, 10)),
  cooldownMs: Math.max(0, numberOr(process.env.SCALE_COOLDOWN_MS, 30_000)),
  estimatedWorkerMemoryBytes:
    numberOr(process.env.ESTIMATED_WORKER_MEMORY_MB, 320) * 1024 * 1024,
  minFreeMemoryAfterScaleUpBytes:
    numberOr(process.env.MIN_FREE_MEMORY_AFTER_SCALE_UP_MB, 768) * 1024 * 1024,
  maxCpuLoadFractionAfterScaleUp: numberOr(
    process.env.MAX_CPU_LOAD_FRACTION_AFTER_SCALE_UP,
    0.85,
  ),
  // Number of heavy waiting jobs that alone justifies a scale-up (see
  // heavyJobPayloadThresholdBytes above).
  heavyJobCountThreshold: numberOr(process.env.HEAVY_JOB_COUNT_THRESHOLD, 2),
  // Average CPU load (fraction of their own allotment) active workers must
  // reach, while at least one job waits, to alone justify a scale-up.
  busyWorkerCpuLoadThreshold: numberOr(
    process.env.BUSY_WORKER_CPU_LOAD_THRESHOLD,
    0.8,
  ),
};
