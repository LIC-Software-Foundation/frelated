import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const rootDir = path.resolve(appDir, '../..');

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

[
  path.join(appDir, '.env'),
  path.join(appDir, 'src/.env'),
  path.join(rootDir, 'apps/projects-api/.env'),
  path.join(rootDir, 'apps/projects-api/src/.env'),
].forEach(loadEnvFile);

const authSecret =
  process.env.AUTH_SECRET || 'frelated-dev-auth-secret-change-me';

export const env = {
  appDir,
  rootDir,
  port: Number(process.env.PORT) || 8080,
  host: process.env.HOST || '0.0.0.0',
  authSecret,
  frontendOrigin: process.env.FRONTEND_ORIGIN || '*',
  projectsApiUrl: process.env.PROJECTS_API_URL || 'http://localhost:3000',
  collabStoreRoot: process.env.COLLAB_STORE_ROOT || path.join(appDir, '.store'),
  dataEncryptionKey: process.env.DATA_ENCRYPTION_KEY || authSecret,
};
