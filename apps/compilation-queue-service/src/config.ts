const numberOr = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && value !== undefined && value !== ''
    ? parsed
    : fallback;
};

const configuredSecret = (name: string, developmentFallback: string): string =>
  process.env[name] || developmentFallback;

export const config = {
  host: process.env.HOST || '0.0.0.0',
  port: numberOr(process.env.PORT, 3200),
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  queueName: process.env.COMPILATION_QUEUE_NAME || 'frelated-latex',
  dataEncryptionKey: configuredSecret(
    'DATA_ENCRYPTION_KEY',
    'frelated-dev-encryption-key-change-me',
  ),
  projectsApiToken: configuredSecret(
    'COMPILATION_PROJECTS_API_TOKEN',
    'frelated-dev-projects-api-token-change-me',
  ),
  workerToken: configuredSecret(
    'COMPILATION_WORKER_TOKEN',
    'frelated-dev-worker-token-change-me',
  ),
  autoscalerToken: configuredSecret(
    'COMPILATION_AUTOSCALER_TOKEN',
    'frelated-dev-autoscaler-token-change-me',
  ),
  heavyJobPayloadThresholdBytes:
    numberOr(process.env.HEAVY_JOB_PAYLOAD_THRESHOLD_MB, 3) * 1024 * 1024,
};
