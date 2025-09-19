import { FastifyInstance } from 'fastify';

export default async function healthRoutes(server: FastifyInstance) {
  server.get('/ping', async () => ({ pong: true }));
}
