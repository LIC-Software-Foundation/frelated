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

  // The autoscaler sees the queue only through the queue service's scoped
  // metrics endpoint; it never receives Redis credentials or job payloads.
  compilationServiceUrl:
    process.env.COMPILATION_SERVICE_URL || 'http://localhost:3200',
  compilationAutoscalerToken:
    process.env.COMPILATION_AUTOSCALER_TOKEN ||
    'frelated-dev-autoscaler-token-change-me',
  compilationServiceTimeoutMs: Math.max(
    500,
    numberOr(process.env.COMPILATION_SERVICE_TIMEOUT_MS, 3000),
  ),

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
  workerRedisUrl:
    process.env.COMPILATION_WORKER_REDIS_URL || 'redis://redis:6379',
  workerCompilationServiceUrl:
    process.env.COMPILATION_SERVICE_URL ||
    'http://compilation-queue-service:3200',
  workerCompilationServiceToken:
    process.env.COMPILATION_WORKER_TOKEN ||
    'frelated-dev-worker-token-change-me',
  workerCompilationTimeoutMs: numberOr(
    process.env.COMPILATION_TIMEOUT_MS,
    120_000,
  ),
  workerMemoryBytes:
    numberOr(process.env.COMPILATION_WORKER_MEMORY_MB, 768) * 1024 * 1024,
  workerNanoCpus: Math.round(
    numberOr(process.env.COMPILATION_WORKER_CPUS, 1) * 1_000_000_000,
  ),
  workerPidsLimit: Math.max(
    16,
    Math.floor(numberOr(process.env.COMPILATION_WORKER_PIDS_LIMIT, 128)),
  ),
  workerTmpfsSizeMb: Math.max(
    64,
    Math.floor(numberOr(process.env.COMPILATION_WORKER_TMPFS_SIZE_MB, 384)),
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
