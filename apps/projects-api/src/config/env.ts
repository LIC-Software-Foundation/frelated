import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve paths relative to this file's location so they are correct regardless
// of the working directory from which the process is started (monorepo root vs
// apps/projects-api/).  src/config/env.ts → go up 2 levels → APP_DIR, then up
// 2 more → monorepo ROOT_DIR.
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
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = parseEnvValue(line.slice(separatorIndex + 1));

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
};

loadEnvFile(path.join(APP_DIR, '.env'));
loadEnvFile(path.join(APP_DIR, 'src/.env'));

const mongodbUrl = process.env.MONGODB_URL || '';
const databaseUrl = process.env.DATABASE_URL || '';
const rawPersistenceDriver = process.env.PERSISTENCE_DRIVER || '';

export const env = {
  rootDir: ROOT_DIR,
  appDir: APP_DIR,
  dataFilePath:
    process.env.DATA_FILE_PATH || path.join(APP_DIR, '.data/store.json'),
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  authSecret: process.env.AUTH_SECRET || 'frelated-dev-auth-secret-change-me',
  persistenceDriver: mongodbUrl
    ? 'mongodb'
    : rawPersistenceDriver === 'prisma'
      ? 'prisma'
      : 'mongodb',
  databaseUrl,
  mongodbUrl,
  mongodbDbName: process.env.MONGODB_DB_NAME || '',
  mongodbRequireTls: process.env.MONGODB_REQUIRE_TLS === 'true',
  mongodbTlsCaFile: process.env.MONGODB_TLS_CA_FILE || '',
  dataEncryptionKey: process.env.DATA_ENCRYPTION_KEY || '',
  frontendOrigin: process.env.FRONTEND_ORIGIN || '*',
  collabServerUrl: process.env.COLLAB_SERVER_URL || 'http://localhost:8080',
  prismaSchemaPath:
    process.env.PRISMA_SCHEMA_PATH ||
    path.join(APP_DIR, 'prisma/schema.prisma'),
  autoMigrateOnStartup:
    process.env.PRISMA_AUTO_MIGRATE !== 'false' && Boolean(databaseUrl),
};
