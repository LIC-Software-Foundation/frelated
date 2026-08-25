import type { FastifyInstance, FastifyReply } from 'fastify';
import { projectsService } from '../services/projects.service';

/** Known business error codes thrown intentionally by the service layer. */
const BUSINESS_ERRORS = new Set([
  'PROJECT_NOT_FOUND',
  'FORBIDDEN',
  'PENDING_APPROVAL',
  'COLLABORATOR_NOT_FOUND',
  'FILE_NOT_FOUND',
]);

/** Returns the error message only if it was thrown intentionally by the service.
 *  Raw Prisma / database errors are replaced by a safe generic message. */
const resolveMessage = (
  error: unknown,
  fallback = 'Une erreur est survenue.',
): string => {
  if (!(error instanceof Error)) return fallback;
  const msg = error.message;
  if (BUSINESS_ERRORS.has(msg)) return msg;
  if (
    msg.includes('Mongo') ||
    msg.includes('mongo') ||
    msg.includes('Server selection timed out') ||
    msg.includes('ECONNREFUSED 127.0.0.1:27017') ||
    msg.includes('connect ECONNREFUSED') ||
    msg.includes('querySrv')
  ) {
    return 'MONGODB_UNAVAILABLE';
  }
  if (
    msg.includes('Raw query failed') ||
    msg.includes('PrismaClient') ||
    msg.startsWith('P1') ||
    msg.startsWith('P2') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('Incorrect') // MySQL data type errors
  ) {
    return fallback;
  }
  return msg;
};

const handleProjectError = (reply: FastifyReply, error: unknown) => {
  const message = resolveMessage(error);

  if (message === 'PROJECT_NOT_FOUND') {
    reply.status(404).send({ message: 'Projet introuvable.' });
    return;
  }

  if (message === 'FORBIDDEN') {
    reply.status(403).send({ message: 'Accès refusé.' });
    return;
  }

  if (message === 'PENDING_APPROVAL') {
    reply.status(403).send({ message: 'PENDING_APPROVAL' });
    return;
  }

  if (message === 'COLLABORATOR_NOT_FOUND') {
    reply.status(404).send({ message: 'Collaborateur introuvable.' });
    return;
  }

  if (message === 'FILE_NOT_FOUND') {
    reply.status(404).send({ message: 'Fichier introuvable.' });
    return;
  }

  if (message === 'MONGODB_UNAVAILABLE') {
    reply.status(503).send({
      message:
        'Le stockage MongoDB des projets est indisponible. Verifie MONGODB_URL et que MongoDB est demarre.',
    });
    return;
  }

  console.error('[projects] Unhandled error:', error);
  reply
    .status(500)
    .send({ message: 'Une erreur est survenue. Veuillez réessayer.' });
};

export default async function projectsRoutes(server: FastifyInstance) {
  server.get(
    '/',
    { preHandler: server.authenticate },
    async (request, reply) => {
      if (!request.currentUser) {
        return reply.status(401).send({ message: 'Authentification requise.' });
      }

      const ownerEmail =
        typeof request.query === 'object' &&
        request.query !== null &&
        'ownerEmail' in request.query
          ? String((request.query as { ownerEmail?: string }).ownerEmail || '')
          : undefined;

      const projects = await projectsService.listProjects(
        request.currentUser,
        ownerEmail || undefined,
      );

      return { projects };
    },
  );

  server.get(
    '/shared/:ownerEmail/:projectId',
    { preHandler: server.authenticate },
    async (request, reply) => {
      if (!request.currentUser) {
        return reply.status(401).send({ message: 'Authentification requise.' });
      }

      try {
        const project = await projectsService.getSharedProject(
          request.currentUser,
          request.params,
        );

        return { project };
      } catch (error) {
        handleProjectError(reply, error);
      }
    },
  );

  server.post(
    '/',
    { preHandler: server.authenticate },
    async (request, reply) => {
      if (!request.currentUser) {
        return reply.status(401).send({ message: 'Authentification requise.' });
      }

      try {
        const project = await projectsService.createProject(
          request.currentUser,
          request.body,
        );
        reply.status(201);
        return { project };
      } catch (error) {
        handleProjectError(reply, error);
      }
    },
  );

  server.patch(
    '/:projectId',
    { preHandler: server.authenticate },
    async (request, reply) => {
      if (!request.currentUser) {
        return reply.status(401).send({ message: 'Authentification requise.' });
      }

      try {
        const params = request.params as { projectId: string };
        const project = await projectsService.renameProject(
          request.currentUser,
          params.projectId,
          request.body,
        );
        return { project };
      } catch (error) {
        handleProjectError(reply, error);
      }
    },
  );

  server.post(
    '/:projectId/open',
    { preHandler: server.authenticate },
    async (request, reply) => {
      if (!request.currentUser) {
        return reply.status(401).send({ message: 'Authentification requise.' });
      }

      try {
        const params = request.params as { projectId: string };
        const project = await projectsService.markProjectAsOpened(
          request.currentUser,
          params.projectId,
        );
        return { project };
      } catch (error) {
        handleProjectError(reply, error);
      }
    },
  );

  server.patch(
    '/:projectId/files/:fileId',
    { preHandler: server.authenticate },
    async (request, reply) => {
      if (!request.currentUser) {
        return reply.status(401).send({ message: 'Authentification requise.' });
      }

      try {
        const params = request.params as { projectId: string; fileId: string };
        const body = request.body as { content?: string };

        if (typeof body.content !== 'string') {
          return reply
            .status(400)
            .send({ message: 'Le champ content est requis.' });
        }

        await projectsService.updateFileContent(
          request.currentUser,
          params.projectId,
          params.fileId,
          body.content,
        );

        reply.status(204).send();
      } catch (error) {
        handleProjectError(reply, error);
      }
    },
  );

  server.put(
    '/:projectId/files',
    { preHandler: server.authenticate },
    async (request, reply) => {
      if (!request.currentUser) {
        return reply.status(401).send({ message: 'Authentification requise.' });
      }

      try {
        const params = request.params as { projectId: string };
        const project = await projectsService.replaceProjectFiles(
          request.currentUser,
          params.projectId,
          request.body,
        );
        return { project };
      } catch (error) {
        handleProjectError(reply, error);
      }
    },
  );

  server.post(
    '/:projectId/collaborators/:collaboratorId/approve',
    { preHandler: server.authenticate },
    async (request, reply) => {
      if (!request.currentUser) {
        return reply.status(401).send({ message: 'Authentification requise.' });
      }

      try {
        const params = request.params as {
          projectId: string;
          collaboratorId: string;
        };
        const project = await projectsService.approveCollaborator(
          request.currentUser,
          params.projectId,
          params.collaboratorId,
        );
        return { project };
      } catch (error) {
        handleProjectError(reply, error);
      }
    },
  );

  server.delete(
    '/:projectId/collaborators/:collaboratorId',
    { preHandler: server.authenticate },
    async (request, reply) => {
      if (!request.currentUser) {
        return reply.status(401).send({ message: 'Authentification requise.' });
      }

      try {
        const params = request.params as {
          projectId: string;
          collaboratorId: string;
        };
        const project = await projectsService.removeCollaborator(
          request.currentUser,
          params.projectId,
          params.collaboratorId,
        );
        return { project };
      } catch (error) {
        handleProjectError(reply, error);
      }
    },
  );

  server.put(
    '/:projectId/collaborators',
    { preHandler: server.authenticate },
    async (request, reply) => {
      if (!request.currentUser) {
        return reply.status(401).send({ message: 'Authentification requise.' });
      }

      try {
        const params = request.params as { projectId: string };
        const project = await projectsService.replaceProjectCollaborators(
          request.currentUser,
          params.projectId,
          request.body,
        );
        return { project };
      } catch (error) {
        handleProjectError(reply, error);
      }
    },
  );

  server.delete(
    '/:projectId',
    { preHandler: server.authenticate },
    async (request, reply) => {
      if (!request.currentUser) {
        return reply.status(401).send({ message: 'Authentification requise.' });
      }

      try {
        const params = request.params as { projectId: string };
        await projectsService.deleteProject(
          request.currentUser,
          params.projectId,
        );
        reply.status(204).send();
      } catch (error) {
        handleProjectError(reply, error);
      }
    },
  );
}
