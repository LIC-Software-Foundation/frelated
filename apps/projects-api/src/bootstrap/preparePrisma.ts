import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { env } from '../config/env';

const execFileAsync = promisify(execFile);
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

export async function preparePrisma(): Promise<void> {
  if (!env.autoMigrateOnStartup) {
    return;
  }

  try {
    await execFileAsync(
      pnpmCommand,
      [
        'exec',
        'prisma',
        'db',
        'push',
        '--skip-generate',
        '--schema',
        env.prismaSchemaPath,
      ],
      {
        cwd: env.appDir,
        env: {
          ...process.env,
          DATABASE_URL: env.databaseUrl,
        },
      },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Echec de la preparation Prisma.';
    throw new Error(`Initialisation Prisma impossible: ${message}`);
  }
}
