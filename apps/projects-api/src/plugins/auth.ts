import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { authService } from '../services/auth.service';
import { verifyToken } from '../services/tokens';
import type { ApiUser } from '../domain/models';

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: ApiUser | null;
  }

  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    requireUser: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<ApiUser>;
  }
}

export default fp(async (server) => {
  server.decorateRequest('currentUser', null);

  server.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authorization = request.headers.authorization;

      if (!authorization?.startsWith('Bearer ')) {
        reply.status(401).send({ message: 'Authentification requise.' });
        return;
      }

      const token = authorization.replace('Bearer ', '').trim();
      const payload = verifyToken(token);

      if (!payload) {
        reply.status(401).send({ message: 'Token invalide ou expire.' });
        return;
      }

      const user = await authService.findUserByEmail(payload.email);

      if (!user) {
        reply.status(401).send({ message: 'Utilisateur introuvable.' });
        return;
      }

      request.currentUser = user;
    },
  );

  server.decorate(
    'requireUser',
    async (request: FastifyRequest, reply: FastifyReply) => {
      await server.authenticate(request, reply);

      if (!request.currentUser) {
        throw new Error('UNAUTHENTICATED');
      }

      return request.currentUser;
    },
  );
});
