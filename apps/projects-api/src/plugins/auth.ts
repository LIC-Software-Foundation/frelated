import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { authService } from '../services/auth.service';
import type { ApiUser, AuthPrincipal } from '../domain/models';
import { resolveTokenPrincipal } from '../services/principals';
import { verifyToken } from '../services/tokens';

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: ApiUser | null;
    currentPrincipal: AuthPrincipal | null;
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
    requirePrincipal: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<AuthPrincipal>;
  }
}

export default fp(async (server) => {
  server.decorateRequest('currentUser', null);
  server.decorateRequest('currentPrincipal', null);

  server.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authorization = request.headers.authorization;

      if (!authorization?.startsWith('Bearer ')) {
        reply.status(401).send({ message: 'Authentification requise.' });
        return;
      }

      const token = authorization.replace('Bearer ', '').trim();
      const principal = await resolveTokenPrincipal(token);
      if (!principal) {
        const signedPayload = verifyToken(token);
        reply.status(signedPayload?.kind === 'guest' ? 403 : 401).send({
          message:
            signedPayload?.kind === 'guest'
              ? 'Accès invité expiré ou révoqué.'
              : 'Token invalide ou expire.',
        });
        return;
      }
      request.currentPrincipal = principal;
      if (principal.kind === 'user') {
        request.currentUser = await authService.findUserByEmail(
          principal.email,
        );
      }
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

  server.decorate(
    'requirePrincipal',
    async (request: FastifyRequest, reply: FastifyReply) => {
      await server.authenticate(request, reply);
      if (!request.currentPrincipal) throw new Error('UNAUTHENTICATED');
      return request.currentPrincipal;
    },
  );
});
