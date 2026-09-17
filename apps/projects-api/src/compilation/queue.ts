import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env';
import { decryptString, encryptString } from '../services/dataProtection';
import { settingsSchema, type Settings } from './model';

// Import env before reading process.env (loads the application's .env files).
void env;
export const queueName = 'frelated-latex';
export const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
export const key = (projectId: string) => `compilation:${projectId}`;
export const encode = (value: unknown, projectId: string) =>
  JSON.stringify(
    encryptString(JSON.stringify(value), 'compilation', projectId),
  );
export const decode = <T>(value: string, projectId: string): T =>
  JSON.parse(decryptString(JSON.parse(value), 'compilation', projectId)) as T;

export function createCompilationQueue() {
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    commandTimeout: 5000,
  });
  connection.on('error', (error) =>
    console.error('[compilation redis]', error.message),
  );
  const queue = new Queue(queueName, {
    connection,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { age: 3600, count: 100 },
      removeOnFail: { age: 86400, count: 100 },
    },
  });
  queue.on('error', (error) =>
    console.error('[compilation queue]', error.message),
  );
  return { connection, queue };
}
export async function readSettings(
  redis: Redis,
  projectId: string,
): Promise<Settings> {
  const raw = await redis.hget(key(projectId), 'settings');
  return settingsSchema.parse(raw ? decode(raw, projectId) : {});
}

export async function removeCompilation(projectId: string) {
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    commandTimeout: 5000,
    enableOfflineQueue: false,
  });
  redis.on('error', () => {});
  try {
    await new Promise<void>((resolve, reject) => {
      redis.once('ready', resolve);
      redis.once('error', reject);
    });
    await redis.del(
      key(projectId),
      `${key(projectId)}:sequence`,
      `${key(projectId)}:lock`,
    );
    await redis.publish('frelated-compilation-events', projectId);
  } finally {
    redis.disconnect();
  }
}
