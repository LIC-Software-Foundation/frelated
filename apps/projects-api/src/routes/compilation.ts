import type { FastifyInstance, FastifyReply } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import { projectsService } from '../services/projects.service';
import type { AuthPrincipal } from '../domain/models';
import { resolveTokenPrincipal } from '../services/principals';
import { compilationQueueClient } from '../compilation/client';
import {
  fingerprint,
  makeSnapshot,
  settingsSchema,
} from '../compilation/model';
import {
  inverseSearch,
  sourceSearch,
  type SyncArtifact,
} from '../compilation/synctex';

export default async function compilationRoutes(server: FastifyInstance) {
  const clients = new Map<
    WebSocket,
    { projectId: string; token: string; busy: boolean; lastPayload?: string }
  >();
  const state = (projectId: string) => compilationQueueClient.state(projectId);
  const authorize = async (
    token: string,
    projectId: string,
  ): Promise<AuthPrincipal> => {
    const principal = await resolveTokenPrincipal(token);
    if (!principal) throw new Error('FORBIDDEN');
    await projectsService.getCompilationProject(principal, projectId);
    return principal;
  };
  const sendState = async (socket: WebSocket) => {
    const client = clients.get(socket);
    if (!client || client.busy || socket.readyState !== 1) return;
    client.busy = true;
    try {
      await authorize(client.token, client.projectId);
      const payload = JSON.stringify(await state(client.projectId));
      if (payload !== client.lastPayload) {
        client.lastPayload = payload;
        socket.send(payload);
      }
    } catch {
      socket.close(1008, 'Accès indisponible');
    } finally {
      client.busy = false;
    }
  };
  const notifyProject = (projectId: string) => {
    for (const [socket, client] of clients)
      if (client.projectId === projectId) void sendState(socket);
  };
  // The public WebSocket remains in projects-api. Polling the internal HTTP
  // API avoids giving this service any direct Redis/PubSub dependency.
  const heartbeat = setInterval(() => {
    for (const socket of clients.keys()) void sendState(socket);
  }, 2000);
  heartbeat.unref();
  server.addHook('onClose', async () => {
    clearInterval(heartbeat);
    for (const socket of clients.keys()) socket.close();
  });
  server.get<{ Params: { projectId: string } }>(
    '/:projectId/compilation/events',
    { websocket: true },
    (socket, request) => {
      const timeout = setTimeout(
        () => socket.close(1008, 'Authentification requise'),
        5000,
      );
      socket.on('close', () => {
        clearTimeout(timeout);
        clients.delete(socket);
      });
      socket.on('error', () => {
        clients.delete(socket);
      });
      socket.once('message', (data) => {
        clearTimeout(timeout);
        try {
          const { token } = z
            .object({ token: z.string().max(4096) })
            .parse(JSON.parse(data.toString()));
          clients.set(socket, {
            projectId: request.params.projectId,
            token,
            busy: false,
          });
          void sendState(socket);
        } catch {
          socket.close(1008, 'Authentification invalide');
        }
      });
    },
  );

  server.setErrorHandler((error, _request, reply) => {
    if (error.message === 'FORBIDDEN')
      return reply.code(403).send({ message: 'Accès refusé.' });
    if (error.message === 'PROJECT_NOT_FOUND')
      return reply.code(404).send({ message: 'Projet introuvable.' });
    if (error instanceof z.ZodError)
      return reply
        .code(400)
        .send({ message: 'Paramètres de compilation invalides.' });
    if ('statusCode' in error && error.statusCode === 409)
      return reply.code(409).send({ message: error.message });
    server.log.error(error);
    return reply.code(503).send({
      message:
        'Compilation indisponible. Vérifiez le service de file et le worker LaTeX.',
    });
  });
  server.get<{ Params: { projectId: string } }>(
    '/:projectId/compilation',
    { preHandler: server.authenticate },
    async (request) => {
      await projectsService.getCompilationProject(
        request.currentPrincipal!,
        request.params.projectId,
      );
      return state(request.params.projectId);
    },
  );
  server.put<{ Params: { projectId: string } }>(
    '/:projectId/compilation/settings',
    { preHandler: server.authenticate },
    async (request, reply) => {
      const project = await projectsService.getCompilationProject(
        request.currentPrincipal!,
        request.params.projectId,
        true,
      );
      const settings = settingsSchema.parse(request.body);
      try {
        makeSnapshot(project.files, settings);
      } catch (error) {
        return reply.code(400).send({ message: (error as Error).message });
      }
      const nextState = await compilationQueueClient.settings(
        project.id,
        settings,
      );
      notifyProject(project.id);
      return nextState;
    },
  );
  server.post<{ Params: { projectId: string } }>(
    '/:projectId/compilation',
    { preHandler: server.authenticate },
    async (request, reply) => {
      const projectId = request.params.projectId;
      const project = await projectsService.getCompilationProject(
        request.currentPrincipal!,
        projectId,
        true,
      );
      const { onlyIfChanged } = z
        .object({ onlyIfChanged: z.boolean().default(false) })
        .parse(request.body ?? {});
      // Compile only persisted project sources, never transient editor state.
      let snapshot;
      try {
        snapshot = makeSnapshot(
          project.files,
          (await compilationQueueClient.state(projectId)).settings,
        );
      } catch (error) {
        return reply.code(400).send({ message: (error as Error).message });
      }
      const submitted = await compilationQueueClient.submit({
        projectId,
        hash: fingerprint(snapshot),
        snapshot,
        onlyIfChanged,
      });
      notifyProject(projectId);
      return reply.code(submitted.accepted ? 202 : 200).send(submitted.state);
    },
  );
  server.get<{ Params: { projectId: string } }>(
    '/:projectId/compilation/pdf',
    { preHandler: server.authenticate },
    async (request, reply) => {
      const projectId = request.params.projectId;
      await projectsService.getCompilationProject(
        request.currentPrincipal!,
        projectId,
      );
      try {
        const pdf = await compilationQueueClient.pdf(projectId);
        reply
          .header('Cache-Control', 'private, no-store')
          .header('Content-Disposition', 'inline; filename="document.pdf"');
        return reply.type('application/pdf').send(pdf);
      } catch (error) {
        if (
          error instanceof Error &&
          'statusCode' in error &&
          error.statusCode === 404
        )
          return reply.code(404).send({ message: 'Aucun PDF disponible.' });
        throw error;
      }
    },
  );

  const readSyncArtifact = async (
    projectId: string,
  ): Promise<SyncArtifact | null> => {
    return compilationQueueClient.syncArtifact(projectId);
  };

  const sendSyncError = (reply: FastifyReply, error: unknown) => {
    const code = error instanceof Error ? error.message : '';
    if (code === 'INVALID_SYNC_PATH') {
      return reply
        .code(400)
        .send({ message: 'Chemin source SyncTeX invalide.' });
    }
    if (code === 'SYNC_SOURCE_NOT_FOUND') {
      return reply.code(404).send({
        message: 'Ce fichier ne faisait pas partie de la dernière compilation.',
      });
    }
    if (code === 'SYNCTEX_NO_RESULT' || code.startsWith('SYNCTEX_FAILED:')) {
      return reply.code(422).send({
        message:
          'Aucune zone de texte synchronisable n’a été trouvée près de cette position.',
      });
    }
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return reply.code(503).send({
        message: 'Le moteur SyncTeX est indisponible sur le serveur.',
      });
    }
    server.log.error(error);
    return reply
      .code(500)
      .send({ message: 'La synchronisation SyncTeX a échoué.' });
  };

  const requireDisplayedArtifact = (
    reply: FastifyReply,
    artifact: SyncArtifact | null,
    displayedJobId: string,
  ) => {
    if (!artifact) {
      reply.code(404).send({
        message:
          'Aucun index SyncTeX n’est disponible. Relancez la compilation.',
      });
      return null;
    }
    if (artifact.jobId !== displayedJobId) {
      reply.code(409).send({
        message:
          'Un nouveau PDF est prêt. Attendez son affichage puis recommencez la synchronisation.',
      });
      return null;
    }
    return artifact;
  };

  server.get<{ Params: { projectId: string } }>(
    '/:projectId/compilation/sync/source',
    { preHandler: server.authenticate },
    async (request, reply) => {
      const projectId = request.params.projectId;
      const project = await projectsService.getCompilationProject(
        request.currentPrincipal!,
        projectId,
      );
      const query = z
        .object({
          file: z.string().min(1).max(240),
          line: z.coerce.number().int().min(1).max(10_000_000),
          column: z.coerce.number().int().min(0).max(1_000_000).default(0),
          pdfJobId: z.string().uuid(),
        })
        .parse(request.query);
      const artifact = requireDisplayedArtifact(
        reply,
        await readSyncArtifact(projectId),
        query.pdfJobId,
      );
      if (!artifact) return;
      try {
        const target = await sourceSearch(artifact, query);
        const stale =
          artifact.stale ||
          fingerprint(
            makeSnapshot(project.files, artifact.snapshot.settings),
          ) !== artifact.hash;
        return { ...target, pdfJobId: artifact.jobId, stale };
      } catch (error) {
        return sendSyncError(reply, error);
      }
    },
  );

  server.get<{ Params: { projectId: string } }>(
    '/:projectId/compilation/sync/pdf',
    { preHandler: server.authenticate },
    async (request, reply) => {
      const projectId = request.params.projectId;
      const project = await projectsService.getCompilationProject(
        request.currentPrincipal!,
        projectId,
      );
      const query = z
        .object({
          page: z.coerce.number().int().min(1).max(100_000),
          x: z.coerce.number().finite().min(0).max(1_000_000),
          y: z.coerce.number().finite().min(0).max(1_000_000),
          pdfJobId: z.string().uuid(),
        })
        .parse(request.query);
      const artifact = requireDisplayedArtifact(
        reply,
        await readSyncArtifact(projectId),
        query.pdfJobId,
      );
      if (!artifact) return;
      try {
        const source = await inverseSearch(artifact, query);
        const stale =
          artifact.stale ||
          fingerprint(
            makeSnapshot(project.files, artifact.snapshot.settings),
          ) !== artifact.hash;
        return { ...source, pdfJobId: artifact.jobId, stale };
      } catch (error) {
        return sendSyncError(reply, error);
      }
    },
  );
}
