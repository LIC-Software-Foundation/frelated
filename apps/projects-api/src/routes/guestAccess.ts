import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env';
import { guestAccessService } from '../services/guestAccess.service';
import { projectsService } from '../services/projects.service';

const attempts = new Map<string, { count: number; resetAt: number }>();
const enforceRateLimit = (
  key: string,
  limit: number,
  windowMs: number,
  reply: FastifyReply,
) => {
  const now = Date.now();
  const current = attempts.get(key);
  const entry =
    !current || current.resetAt <= now
      ? { count: 1, resetAt: now + windowMs }
      : { ...current, count: current.count + 1 };
  attempts.set(key, entry);
  if (entry.count <= limit) return true;
  reply
    .code(429)
    .header('Retry-After', Math.ceil((entry.resetAt - now) / 1000))
    .send({ message: 'Trop de tentatives. Réessayez plus tard.' });
  return false;
};

const handleError = (reply: FastifyReply, error: unknown) => {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ message: 'Données invalides.' });
  }
  const code = error instanceof Error ? error.message : '';
  if (code === 'PROJECT_NOT_FOUND' || code === 'INVITATION_NOT_FOUND') {
    return reply.code(404).send({ message: 'Ressource introuvable.' });
  }
  if (code === 'FORBIDDEN') {
    return reply.code(403).send({ message: 'Accès refusé.' });
  }
  if (code === 'PROJECT_PARTICIPANT_LIMIT') {
    return reply.code(409).send({
      message: 'Le nombre maximal de participants du projet est atteint.',
    });
  }
  if (code === 'GUEST_INVITATION_LIMIT') {
    return reply.code(409).send({
      message: `La limite de ${env.projectMaxGuestInvitations} invitations actives par projet est atteinte.`,
    });
  }
  if (code === 'SMTP_NOT_CONFIGURED') {
    return reply.code(503).send({
      message: "L'envoi d'e-mail est indisponible : SMTP n'est pas configuré.",
    });
  }
  if (code === 'MAIL_DELIVERY_FAILED') {
    return reply.code(503).send({
      message:
        "L'e-mail n'a pas pu être remis à MailHog. Vérifiez que le service est démarré.",
    });
  }
  if (
    code === 'INVALID_INVITATION' ||
    code === 'INVITATION_REVOKED' ||
    code === 'INVITATION_EXPIRED' ||
    code === 'INVALID_JOIN_LINK'
  ) {
    return reply.code(403).send({ message: code });
  }
  return reply.code(500).send({ message: 'Opération impossible.' });
};

export default async function guestAccessRoutes(server: FastifyInstance) {
  server.post('/guest/invitations/redeem', async (request, reply) => {
    if (!enforceRateLimit(`redeem:${request.ip}`, 20, 60_000, reply)) return;
    try {
      const { token } = z
        .object({ token: z.string().min(32).max(256) })
        .parse(request.body);
      return await guestAccessService.redeem(token);
    } catch (error) {
      return handleError(reply, error);
    }
  });

  server.post(
    '/projects/:projectId/guest-invitations',
    { preHandler: server.authenticate },
    async (request, reply) => {
      if (!request.currentUser) {
        return reply.code(403).send({ message: 'Propriétaire requis.' });
      }
      if (
        !enforceRateLimit(`invite:${request.currentUser.id}`, 20, 60_000, reply)
      ) {
        return;
      }
      try {
        const { projectId } = request.params as { projectId: string };
        const invitation = await guestAccessService.createInvitation(
          request.currentUser,
          projectId,
          request.body,
        );
        return reply.code(201).send({ invitation });
      } catch (error) {
        return handleError(reply, error);
      }
    },
  );

  server.get(
    '/projects/:projectId/guest-invitations',
    { preHandler: server.authenticate },
    async (request, reply) => {
      if (!request.currentUser) {
        return reply.code(403).send({ message: 'Propriétaire requis.' });
      }
      try {
        const { projectId } = request.params as { projectId: string };
        return {
          invitations: await guestAccessService.listInvitations(
            request.currentUser,
            projectId,
          ),
          maximumActiveInvitations: env.projectMaxGuestInvitations,
        };
      } catch (error) {
        return handleError(reply, error);
      }
    },
  );

  server.delete(
    '/projects/:projectId/guest-invitations/:invitationId',
    { preHandler: server.authenticate },
    async (request, reply) => {
      if (!request.currentUser) {
        return reply.code(403).send({ message: 'Propriétaire requis.' });
      }
      try {
        const { projectId, invitationId } = request.params as {
          projectId: string;
          invitationId: string;
        };
        await guestAccessService.revokeInvitation(
          request.currentUser,
          projectId,
          invitationId,
        );
        return reply.code(204).send();
      } catch (error) {
        return handleError(reply, error);
      }
    },
  );

  server.post(
    '/projects/:projectId/join-links',
    { preHandler: server.authenticate },
    async (request, reply) => {
      if (!request.currentUser) {
        return reply.code(403).send({ message: 'Propriétaire requis.' });
      }
      try {
        const { projectId } = request.params as { projectId: string };
        return await guestAccessService.createJoinLink(
          request.currentUser,
          projectId,
        );
      } catch (error) {
        return handleError(reply, error);
      }
    },
  );

  server.post(
    '/join/redeem',
    { preHandler: server.authenticate },
    async (request, reply) => {
      if (!request.currentUser) {
        return reply.code(403).send({ message: 'Compte utilisateur requis.' });
      }
      if (
        !enforceRateLimit(`join:${request.currentUser.id}`, 30, 60_000, reply)
      ) {
        return;
      }
      try {
        const { token } = z
          .object({ token: z.string().min(32).max(256) })
          .parse(request.body);
        const link = await guestAccessService.resolveJoinLink(token);
        const project = await projectsService.addApprovedCollaborator(
          request.currentUser,
          link.projectId,
        );
        return { project };
      } catch (error) {
        return handleError(reply, error);
      }
    },
  );
}
