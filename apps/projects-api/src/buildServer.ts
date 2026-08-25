import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import corsPlugin from './plugins/cors';
import authPlugin from './plugins/auth';
import authRoutes from './routes/auth';
import healthRoutes from './routes/health';
import projectsRoutes from './routes/projects';
import internalRoutes from './routes/internal';

export async function buildServer() {
  const server = Fastify({ logger: true });

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
  await server.register(internalRoutes, { prefix: '/internal' });

  return server;
}
