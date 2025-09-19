import fp from 'fastify-plugin';
import { PrismaClient } from '../../generated/prisma';

export default fp(async (server) => {
  const prisma = new PrismaClient();
  await prisma.$connect();

  server.decorate('prisma', prisma);

  server.addHook('onClose', async (srv) => {
    await srv.prisma.$disconnect();
  });
});

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}
