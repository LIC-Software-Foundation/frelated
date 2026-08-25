import type { FastifyInstance } from 'fastify';
import { authService } from '../services/auth.service';

/** Returns the error message only if it was thrown intentionally by the service.
 *  Raw database / Prisma errors are replaced by a safe fallback message. */
const safeMessage = (error: unknown, fallback: string): string => {
  if (!(error instanceof Error)) return fallback;
  const msg = error.message;
  // Prisma raw query errors, connection errors — never expose to client
  if (
    msg.includes('Raw query failed') ||
    msg.includes('PrismaClient') ||
    msg.includes('P1') || // connection errors
    msg.includes('P2') || // query errors
    msg.includes('ECONNREFUSED')
  ) {
    return fallback;
  }
  return msg;
};

export default async function authRoutes(server: FastifyInstance) {
  server.post('/register', async (request, reply) => {
    try {
      const session = await authService.register(request.body);
      return session;
    } catch (error) {
      const message = safeMessage(
        error,
        'Inscription impossible. Veuillez réessayer.',
      );
      reply.status(400).send({ message });
    }
  });

  server.post('/login', async (request, reply) => {
    try {
      const session = await authService.login(request.body);
      return session;
    } catch (error) {
      const message = safeMessage(
        error,
        'Connexion impossible. Veuillez réessayer.',
      );
      reply.status(401).send({ message });
    }
  });

  server.get(
    '/me',
    { preHandler: server.authenticate },
    async (request, reply) => {
      if (!request.currentUser) {
        return reply.status(401).send({ message: 'Authentification requise.' });
      }

      return { user: request.currentUser };
    },
  );
}
