import { buildServer } from './buildServer';

async function start() {
  const server = await buildServer();

  try {
    await server.listen({ port: 3000 });
    console.log('Projects API running on http://localhost:3000');
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

start();
