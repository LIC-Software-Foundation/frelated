import { buildServer } from './buildServer';
import { preparePrisma } from './bootstrap/preparePrisma';
import { env } from './config/env';
import { mongoStore } from './repositories/mongoStore';

async function start() {
  if (env.databaseUrl) {
    await preparePrisma();
  }

  if (env.persistenceDriver === 'mongodb') {
    await mongoStore.ensureReady();
  }

  const server = await buildServer();

  try {
    await server.listen({ port: env.port, host: env.host });
    console.log(`Projects API running on http://${env.host}:${env.port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

start();
