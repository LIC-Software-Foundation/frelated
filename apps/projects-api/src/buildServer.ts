import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import compilationRoutes from './routes/compilation';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import corsPlugin from './plugins/cors';
import authPlugin from './plugins/auth';
import authRoutes from './routes/auth';
import healthRoutes from './routes/health';
import projectsRoutes from './routes/projects';
import internalRoutes from './routes/internal';
import guestAccessRoutes from './routes/guestAccess';
import proofreadingRoutes from './routes/proofreading';
import notificationRoutes from './routes/notifications';

export async function buildServer() {
  // Project files may contain up to 20 MiB of binary data. Base64 and JSON add
  // overhead, so the HTTP envelope must be larger than the project limit.
  const server = Fastify({ logger: true, bodyLimit: 30 * 1024 * 1024 });

  await server.register(websocket, { options: { maxPayload: 8192 } });
  await server.register(corsPlugin);
  await server.register(authPlugin);

  await server.register(swagger, {
    openapi: {
      info: {
        title: 'Frelated Projects API',
        version: '1.0.0',
      },
    },
  });

  await server.register(swaggerUi, {
    routePrefix: '/docs',
  });

  await server.register(healthRoutes, { prefix: '/health' });
  await server.register(authRoutes, { prefix: '/auth' });
  await server.register(projectsRoutes, { prefix: '/projects' });
  await server.register(compilationRoutes, { prefix: '/projects' });
  await server.register(internalRoutes, { prefix: '/internal' });
  await server.register(guestAccessRoutes);
  await server.register(proofreadingRoutes);
  await server.register(notificationRoutes);

  return server;
}
