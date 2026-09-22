import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env';
import { proofreadingProvider } from '../proofreading/provider';

const requestSchema = z.object({
  text: z.string().min(1).max(50_000),
  language: z.enum(['fr', 'en', 'auto']).optional(),
});

export default async function proofreadingRoutes(server: FastifyInstance) {
  server.post(
    '/proofreading/check',
    { preHandler: server.authenticate },
    async (request, reply) => {
      if (!request.currentPrincipal) {
        return reply.code(401).send({ message: 'Authentification requise.' });
      }
      const parsed = requestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ message: 'Texte ou langue invalide.' });
      }
      try {
        return await proofreadingProvider.check(
          parsed.data.text,
          parsed.data.language || env.proofreadingDefaultLanguage,
        );
      } catch (error) {
        if ((error as Error).name === 'AbortError')
          return reply.code(499).send();
        server.log.warn({ err: error }, 'Proofreading provider unavailable');
        return reply
          .code(503)
          .send({ message: 'Correcteur linguistique indisponible.' });
      }
    },
  );
}
