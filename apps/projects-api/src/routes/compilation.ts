import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { WebSocket } from 'ws';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { projectsService } from '../services/projects.service';
import type { AuthPrincipal } from '../domain/models';
import { resolveTokenPrincipal } from '../services/principals';
import {
  createCompilationQueue,
  decode,
  encode,
  key,
  readSettings,
} from '../compilation/queue';
import {
  fingerprint,
  makeSnapshot,
  settingsSchema,
  type CompilationResult,
} from '../compilation/model';
import {
  inverseSearch,
  sourceSearch,
  type SyncArtifact,
} from '../compilation/synctex';

export default async function compilationRoutes(server: FastifyInstance) {
  let resources: ReturnType<typeof createCompilationQueue> | undefined;
  let subscriber: Redis | undefined;
  const clients = new Map<
    WebSocket,
    { projectId: string; token: string; busy: boolean }
  >();
  const get = () => {
    if (!resources) {
      resources = createCompilationQueue();
      const sub = resources.connection.duplicate();
      subscriber = sub;
      sub.on('error', (error) => server.log.error(error));
      void sub
        .subscribe('frelated-compilation-events')
        .catch((error) => server.log.error(error));
      sub.on('message', (_channel, projectId) => {
        for (const [socket, client] of clients)
          if (client.projectId === projectId) void sendState(socket);
      });
    }
    return resources;
  };
  const state = async (projectId: string) => {
    const fields = [
      'result',
      'status',
      'jobId',
      'revision',
      'pdfJobId',
      'synctexJobId',
      'hash',
      'pdfHash',
    ];
    const values = await get().connection.hmget(key(projectId), ...fields);
    const data = Object.fromEntries(
      fields.map((field, index) => [field, values[index]]),
    );
    const result = data.result
      ? decode<CompilationResult>(data.result, projectId)
      : { logs: [] };
    return {
      ...result,
      status: data.status || 'idle',
      jobId: data.jobId ?? undefined,
      revision: Number(data.revision || 0),
      pdfJobId: data.pdfJobId ?? undefined,
      synctexJobId: data.synctexJobId ?? undefined,
      isPdfStale: Boolean(
        data.pdfHash && data.hash && data.pdfHash !== data.hash,
      ),
      settings: await readSettings(get().connection, projectId),
    };
  };
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
      socket.send(JSON.stringify(await state(client.projectId)));
    } catch {
      socket.close(1008, 'Accès indisponible');
    } finally {
      client.busy = false;
    }
  };
  // Poll is a recovery path for missed Pub/Sub events and permission revocations.
  const heartbeat = setInterval(() => {
    for (const socket of clients.keys()) void sendState(socket);
  }, 10000);
  heartbeat.unref();
  server.addHook('onClose', async () => {
    clearInterval(heartbeat);
    subscriber?.disconnect();
    for (const socket of clients.keys()) socket.close();
    if (resources) {
      await resources.queue.close();
      resources.connection.disconnect();
    }
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
    server.log.error(error);
    return reply.code(503).send({
      message: 'Compilation indisponible. Vérifiez Redis et le worker LaTeX.',
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
      const redis = get().connection;
      await redis.hset(
        key(project.id),
        'settings',
        encode(settings, project.id),
      );
      await redis.publish('frelated-compilation-events', project.id);
      return state(project.id);
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
      const { connection: redis, queue } = get();
      const lock = randomUUID();
      if (!(await redis.set(`${key(projectId)}:lock`, lock, 'PX', 15000, 'NX')))
        return reply.code(409).send({
          message: 'Une demande de compilation est déjà en cours. Réessayez.',
        });
      try {
        // Ctrl+S/Compiler await REST persistence first. Compile those acknowledged
        // sources, never an uninitialized or reconnecting transient Yjs room.
        let snapshot;
        try {
          snapshot = makeSnapshot(
            project.files,
            await readSettings(redis, projectId),
          );
        } catch (error) {
          return reply.code(400).send({ message: (error as Error).message });
        }
        const hash = fingerprint(snapshot);
        const previousFields = ['status', 'hash', 'pdfHash'];
        const previousValues = await redis.hmget(
          key(projectId),
          ...previousFields,
        );
        const previous = Object.fromEntries(
          previousFields.map((field, index) => [field, previousValues[index]]),
        );
        if (
          (previous.status === 'compiling' && previous.hash === hash) ||
          (onlyIfChanged &&
            previous.pdfHash === hash &&
            previous.status === 'success')
        )
          return state(projectId);
        const jobId = randomUUID();
        const revision = await redis.incr(`${key(projectId)}:sequence`);
        await redis.hset(
          key(projectId),
          'jobId',
          jobId,
          'hash',
          hash,
          'status',
          'compiling',
          'revision',
          revision,
        );
        // A new job owns a fresh log stream. Never expose the previous result
        // while this compilation is queued or running.
        await redis.hdel(key(projectId), 'result');
        try {
          await queue.add(
            'compile',
            { projectId, hash, snapshot: encode(snapshot, projectId) },
            { jobId },
          );
        } catch (error) {
          await redis.hset(
            key(projectId),
            'status',
            'error',
            'result',
            encode(
              {
                logs: [
                  {
                    level: 'error',
                    message: 'La mise en file a échoué. Réessayez.',
                  },
                ],
              },
              projectId,
            ),
          );
          await redis.publish('frelated-compilation-events', projectId);
          throw error;
        }
        await redis.expire(key(projectId), 30 * 86400);
        await redis.publish('frelated-compilation-events', projectId);
        return reply.code(202).send(await state(projectId));
      } finally {
        await redis.eval(
          "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end",
          1,
          `${key(projectId)}:lock`,
          lock,
        );
      }
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
      const pdf = await get().connection.hget(key(projectId), 'pdf');
      if (!pdf)
        return reply.code(404).send({ message: 'Aucun PDF disponible.' });
      reply
        .header('Cache-Control', 'private, no-store')
        .header('Content-Disposition', 'inline; filename="document.pdf"');
      return reply
        .type('application/pdf')
        .send(Buffer.from(decode<string>(pdf, projectId), 'base64'));
    },
  );

  const readSyncArtifact = async (
    projectId: string,
  ): Promise<SyncArtifact | null> => {
    const fields = [
      'pdf',
      'pdfJobId',
      'pdfHash',
      'synctex',
      'synctexJobId',
      'synctexHash',
      'synctexSnapshot',
      'hash',
    ];
    const values = await get().connection.hmget(key(projectId), ...fields);
    const data = Object.fromEntries(
      fields.map((field, index) => [field, values[index]]),
    );
    if (
      !data.pdf ||
      !data.synctex ||
      !data.synctexSnapshot ||
      !data.synctexHash ||
      !data.pdfJobId ||
      data.pdfJobId !== data.synctexJobId ||
      data.pdfHash !== data.synctexHash
    ) {
      return null;
    }
    return {
      jobId: data.pdfJobId,
      pdf: decode<string>(data.pdf, projectId),
      synctex: decode<string>(data.synctex, projectId),
      snapshot: decode(data.synctexSnapshot, projectId),
      hash: data.synctexHash,
      stale: Boolean(data.hash && data.pdfHash !== data.hash),
    };
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
