import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from './config.js';
import {
  projectIdSchema,
  resultSchema,
  settingsSchema,
  snapshotSchema,
} from './contracts.js';
import { CompilationStore } from './store.js';

type Role = 'projects-api' | 'worker' | 'autoscaler';
const tokens: Record<Role, string> = {
  'projects-api': config.projectsApiToken,
  worker: config.workerToken,
  autoscaler: config.autoscalerToken,
};

const authorized = (request: FastifyRequest, role: Role): boolean => {
  const header = request.headers.authorization;
  const supplied = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const expected = tokens[role];
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
};

export function buildServer(store = new CompilationStore()) {
  const server = Fastify({ logger: true, bodyLimit: 64 * 1024 * 1024 });
  const requireRole = (role: Role) => async (request: FastifyRequest) => {
    if (!authorized(request, role)) {
      const error = new Error('UNAUTHORIZED');
      Object.assign(error, { statusCode: 401 });
      throw error;
    }
  };

  server.get('/health', async () => ({ status: 'ok' }));
  server.get(
    '/internal/queue/metrics',
    { preHandler: requireRole('autoscaler') },
    async () => store.metrics(),
  );
  server.get<{ Params: { projectId: string } }>(
    '/internal/compilations/:projectId',
    { preHandler: requireRole('projects-api') },
    async (request) =>
      store.readState(projectIdSchema.parse(request.params.projectId)),
  );
  server.put<{ Params: { projectId: string } }>(
    '/internal/compilations/:projectId/settings',
    { preHandler: requireRole('projects-api') },
    async (request) =>
      store.writeSettings(
        projectIdSchema.parse(request.params.projectId),
        settingsSchema.parse(request.body),
      ),
  );
  server.post(
    '/internal/compilations',
    { preHandler: requireRole('projects-api') },
    async (request, reply) => {
      const input = z
        .object({
          projectId: projectIdSchema,
          hash: z.string().regex(/^[a-f0-9]{64}$/u),
          snapshot: snapshotSchema,
          onlyIfChanged: z.boolean().default(false),
        })
        .parse(request.body);
      try {
        const submitted = await store.submit(
          input.projectId,
          input.hash,
          input.snapshot,
          input.onlyIfChanged,
        );
        return reply.code(submitted.accepted ? 202 : 200).send(submitted.state);
      } catch (error) {
        if (error instanceof Error && error.message === 'SUBMISSION_LOCKED') {
          return reply.code(409).send({
            message: 'Une demande de compilation est déjà en cours. Réessayez.',
          });
        }
        throw error;
      }
    },
  );
  server.get(
    '/internal/jobs/:jobId/current',
    { preHandler: requireRole('worker') },
    async (request) => {
      const params = z
        .object({ jobId: z.string().uuid() })
        .parse(request.params);
      const query = z
        .object({ projectId: projectIdSchema })
        .parse(request.query);
      return {
        current: await store.isCurrentJob(query.projectId, params.jobId),
      };
    },
  );
  server.get<{ Params: { projectId: string } }>(
    '/internal/compilations/:projectId/pdf',
    { preHandler: requireRole('projects-api') },
    async (request, reply) => {
      const pdf = await store.readPdf(
        projectIdSchema.parse(request.params.projectId),
      );
      if (!pdf)
        return reply.code(404).send({ message: 'Aucun PDF disponible.' });
      return reply.type('application/pdf').send(pdf);
    },
  );
  server.get<{ Params: { projectId: string } }>(
    '/internal/compilations/:projectId/sync-artifact',
    { preHandler: requireRole('projects-api') },
    async (request, reply) => {
      const artifact = await store.readSyncArtifact(
        projectIdSchema.parse(request.params.projectId),
      );
      return (
        artifact ?? reply.code(404).send({ message: 'Artefact indisponible.' })
      );
    },
  );
  server.delete<{ Params: { projectId: string } }>(
    '/internal/compilations/:projectId',
    { preHandler: requireRole('projects-api') },
    async (request, reply) => {
      await store.remove(projectIdSchema.parse(request.params.projectId));
      return reply.code(204).send();
    },
  );
  server.post(
    '/internal/jobs/:jobId/result',
    { preHandler: requireRole('worker') },
    async (request, reply) => {
      const params = z
        .object({ jobId: z.string().uuid() })
        .parse(request.params);
      const input = z
        .object({
          projectId: projectIdSchema,
          hash: z.string().regex(/^[a-f0-9]{64}$/u),
          result: resultSchema,
          pdf: z.string().optional(),
          synctex: z.string().optional(),
          snapshot: z.string().min(1),
        })
        .parse(request.body);
      const saved = await store.saveResult({ ...input, jobId: params.jobId });
      return reply.code(saved ? 204 : 409).send();
    },
  );

  server.addHook('onClose', async () => store.close());
  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ message: 'Requête interne invalide.' });
    }
    if (error.message === 'UNAUTHORIZED') {
      return reply
        .code(401)
        .send({ message: 'Authentification interne requise.' });
    }
    server.log.error(error);
    return reply.code(error.statusCode ?? 503).send({
      message: 'Service de file de compilation indisponible.',
    });
  });
  return server;
}
