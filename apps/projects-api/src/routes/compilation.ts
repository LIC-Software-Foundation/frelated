import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { projectsService } from '../services/projects.service';
import { verifyToken } from '../services/tokens';
import { authService } from '../services/auth.service';
import type { ApiUser } from '../domain/models';
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
    const fields = ['result', 'status', 'jobId', 'revision', 'pdfJobId'];
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
      settings: await readSettings(get().connection, projectId),
    };
  };
  const authorize = async (
    token: string,
    projectId: string,
  ): Promise<ApiUser> => {
    const payload = verifyToken(token);
    if (!payload) throw new Error('FORBIDDEN');
    const user = await authService.findUserByEmail(payload.email);
    if (!user) throw new Error('FORBIDDEN');
    await projectsService.getCompilationProject(user, projectId);
    return user;
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
        request.currentUser!,
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
        request.currentUser!,
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
        request.currentUser!,
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
        request.currentUser!,
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
}
