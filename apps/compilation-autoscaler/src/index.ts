import { env } from './config/env.js';
import { createLogger } from './logging/logger.js';
import { HttpQueueDepthProvider } from './adapters/httpQueueDepthProvider.js';
import { HostSystemResourceMonitor } from './adapters/hostSystemResourceMonitor.js';
import { DockerWorkerOrchestrator } from './adapters/dockerWorkerOrchestrator.js';
import { AutoscalerService } from './services/autoscalerService.js';
import { createHealthServer } from './http/healthServer.js';
import type { ScalingPolicyConfig } from './domain/scalingPolicy.js';

const logger = createLogger('compilation-autoscaler');

const policyConfig: ScalingPolicyConfig = {
  scaleUpThreshold: env.scaleUpThreshold,
  scaleDownThreshold: env.scaleDownThreshold,
  minWorkers: env.minWorkers,
  maxWorkers: env.maxWorkers,
  cooldownMs: env.cooldownMs,
  estimatedWorkerMemoryBytes: env.estimatedWorkerMemoryBytes,
  minFreeMemoryAfterScaleUpBytes: env.minFreeMemoryAfterScaleUpBytes,
  maxCpuLoadFractionAfterScaleUp: env.maxCpuLoadFractionAfterScaleUp,
  heavyJobCountThreshold: env.heavyJobCountThreshold,
  busyWorkerCpuLoadThreshold: env.busyWorkerCpuLoadThreshold,
};

const queueDepthProvider = new HttpQueueDepthProvider(
  env.compilationServiceUrl,
  env.compilationAutoscalerToken,
  env.compilationServiceTimeoutMs,
  logger,
);
const systemResourceMonitor = new HostSystemResourceMonitor(logger);
const workerOrchestrator = new DockerWorkerOrchestrator(
  {
    socketPath: env.dockerSocketPath,
    image: env.compilationWorkerImage,
    network: env.dockerNetwork,
    redisUrl: env.workerRedisUrl,
    compilationServiceUrl: env.workerCompilationServiceUrl,
    compilationServiceToken: env.workerCompilationServiceToken,
    authSecret: env.workerAuthSecret,
    dataEncryptionKey: env.workerDataEncryptionKey,
    compilationTimeoutMs: env.workerCompilationTimeoutMs,
    workerMemoryBytes: env.workerMemoryBytes,
    workerNanoCpus: env.workerNanoCpus,
    workerPidsLimit: env.workerPidsLimit,
    workerTmpfsSizeMb: env.workerTmpfsSizeMb,
    gracefulStopTimeoutSeconds: env.workerGracefulStopTimeoutSeconds,
  },
  logger,
);

const autoscaler = new AutoscalerService(
  queueDepthProvider,
  systemResourceMonitor,
  workerOrchestrator,
  policyConfig,
  logger,
);

logger.info(
  `starting: pollIntervalMs=${env.pollIntervalMs} minWorkers=${policyConfig.minWorkers} maxWorkers=${policyConfig.maxWorkers} scaleUpThreshold=${policyConfig.scaleUpThreshold} scaleDownThreshold=${policyConfig.scaleDownThreshold} cooldownMs=${policyConfig.cooldownMs} heavyJobCountThreshold=${policyConfig.heavyJobCountThreshold} busyWorkerCpuLoadThreshold=${policyConfig.busyWorkerCpuLoadThreshold}`,
);

const stopLoop = autoscaler.start(env.pollIntervalMs);

const server = createHealthServer(autoscaler);
server.listen(env.port, env.host, () => {
  logger.info(`health server listening on http://${env.host}:${env.port}`);
});

// Run one decision immediately instead of waiting for the first interval tick.
void autoscaler.tick().catch(() => {
  // Already logged inside tick(); startup must not crash on a transient
  // Redis/Docker hiccup — the interval loop will retry.
});

let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`received ${signal}, shutting down`);
  stopLoop();
  server.close(() => process.exit(0));
  // Safety net in case the server has lingering keep-alive connections.
  setTimeout(() => process.exit(0), 5000).unref();
};
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => shutdown(signal));
