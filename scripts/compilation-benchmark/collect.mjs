import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import os from 'node:os';

const exec = promisify(execFile);

export async function docker(config, args) {
  // No shell: tokens, project IDs and paths are never shell-expanded.
  const { stdout } = await exec('docker', args, {
    cwd: config.root,
    timeout: config.requestTimeoutMs,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

export function memoryBytes(raw) {
  const match = String(raw)
    .trim()
    .match(/^([\d.]+)\s*(B|KiB|MiB|GiB|TiB|kB|MB|GB|TB)$/u);
  if (!match) return null;
  const units = {
    B: 1,
    KiB: 1024,
    MiB: 1024 ** 2,
    GiB: 1024 ** 3,
    TiB: 1024 ** 4,
    kB: 1000,
    MB: 1e6,
    GB: 1e9,
    TB: 1e12,
  };
  return Number(match[1]) * units[match[2]];
}

export async function fleetSnapshot(config) {
  const lines = await docker(config, ['ps', '--format', '{{json .}}']);
  const containers = lines
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const selected = containers.flatMap((container) => {
    const labels = Object.fromEntries(
      String(container.Labels ?? '')
        .split(',')
        .map((label) => {
          const index = label.indexOf('=');
          return [label.slice(0, index), label.slice(index + 1)];
        }),
    );
    const service = labels['com.docker.compose.service'];
    const worker =
      service === 'compilation-worker' ||
      labels['com.frelated.managed-by'] === 'compilation-autoscaler';
    return worker ||
      [
        'redis',
        'projects-api',
        'compilation-queue-service',
        'compilation-autoscaler',
      ].includes(service)
      ? [
          {
            id: container.ID,
            name: container.Names,
            worker,
            service: worker ? 'compilation-worker' : service,
          },
        ]
      : [];
  });
  const workers = selected.filter((container) => container.worker);
  if (!selected.length) return { workerCount: 0, containers: [] };
  const statsText = await docker(config, [
    'stats',
    '--no-stream',
    '--format',
    '{{json .}}',
    ...selected.map((container) => container.id),
  ]);
  const stats = statsText
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return {
    workerCount: workers.length,
    containers: selected.map((container) => {
      const stat = stats.find(
        (entry) => entry.Name === container.name || entry.ID === container.id,
      );
      return {
        ...container,
        cpuPercent: stat ? Number.parseFloat(stat.CPUPerc) : null,
        memoryBytes: stat ? memoryBytes(stat.MemUsage.split('/')[0]) : null,
        memoryLimitBytes: stat
          ? memoryBytes(stat.MemUsage.split('/')[1])
          : null,
      };
    }),
  };
}

export async function hostSnapshot() {
  let availableMemoryBytes = os.freemem();
  try {
    const meminfo = await readFile('/proc/meminfo', 'utf8');
    const available = meminfo.match(/^MemAvailable:\s+(\d+) kB$/mu);
    if (available) availableMemoryBytes = Number(available[1]) * 1024;
  } catch {
    // Portable fallback. Host here means the machine running the benchmark.
  }
  const cpuCount = os.cpus().length;
  return {
    cpuCount,
    normalizedLoad1m: os.loadavg()[0] / Math.max(1, cpuCount),
    availableMemoryBytes,
    totalMemoryBytes: os.totalmem(),
  };
}

export async function collectQueueTimings(config, jobs) {
  // Read-only, bounded batches. No payloads or encryption keys are retrieved.
  const script = `local result = {}; for _, key in ipairs(KEYS) do table.insert(result, redis.call('HMGET', key, 'timestamp', 'processedOn', 'finishedOn')); end; return result;`;
  const accepted = jobs.filter((job) => job.jobId);
  for (let offset = 0; offset < accepted.length; offset += 50) {
    const batch = accepted.slice(offset, offset + 50);
    const output = await docker(config, [
      'compose',
      '--env-file',
      config.envFile,
      'exec',
      '-T',
      'redis',
      'redis-cli',
      '--json',
      'EVAL',
      script,
      String(batch.length),
      ...batch.map((job) => `bull:${config.queueName}:${job.jobId}`),
    ]);
    const rows = JSON.parse(output);
    if (!Array.isArray(rows) || rows.length !== batch.length)
      throw new Error('Réponse Redis de timings invalide.');
    rows.forEach((row, index) => {
      const [queuedAt, processedAt, finishedAt] = row.map((value) =>
        value === null ? null : Number(value),
      );
      const job = batch[index];
      if (
        Number.isFinite(queuedAt) &&
        Number.isFinite(processedAt) &&
        processedAt >= queuedAt
      ) {
        job.queueWaitMs = processedAt - queuedAt;
        job.workerProcessingMs =
          Number.isFinite(finishedAt) && finishedAt >= processedAt
            ? finishedAt - processedAt
            : null;
      }
    });
  }
}
