import type { FastifyInstance } from 'fastify';
import { env } from '../config/env';
import { projectsService } from '../services/projects.service';

/**
 * Internal routes called by the collab-server to persist collaborative edits
 * to the database when the last user leaves a room. Protected by a shared
 * secret (AUTH_SECRET) sent in the X-Sync-Secret header.
 */
export default async function internalRoutes(server: FastifyInstance) {
  server.patch('/projects/:projectId/files/:fileId', async (request, reply) => {
    const syncSecret = request.headers['x-sync-secret'];
    if (!syncSecret || syncSecret !== env.authSecret) {
      return reply
        .status(401)
        .send({ message: 'Secret de synchronisation invalide.' });
    }

    const params = request.params as { projectId: string; fileId: string };
    const body = request.body as { content?: string };

    if (typeof body.content !== 'string') {
      return reply
        .status(400)
        .send({ message: 'Le champ content est requis.' });
    }

    try {
      await projectsService.syncFileContent(
        params.projectId,
        params.fileId,
        body.content,
      );
      reply.status(204).send();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Erreur de synchronisation.';
      reply.status(500).send({ message });
    }
  });
}
