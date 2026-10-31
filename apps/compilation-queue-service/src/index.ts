import { config } from './config.js';
import { buildServer } from './server.js';

const server = buildServer();
await server.listen({ host: config.host, port: config.port });
