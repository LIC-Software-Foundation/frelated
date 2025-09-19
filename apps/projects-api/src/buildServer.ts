import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

// import prismaPlugin from './plugins/prisma';
// import mongoPlugin from './plugins/mongo';

import projectsRoutes from './routes/projects';
import healthRoutes from './routes/health';

export async function buildServer() {
  const server = Fastify();

  // Swagger
  await server.register(swagger, {
    openapi: {
      info: {
        title: 'Projects API',
        version: '1.0.0',
      },
    },
  });

  await server.register(swaggerUi, {
    routePrefix: '/docs',
  });

  // DB plugins
  // await server.register(prismaPlugin);
  // await server.register(mongoPlugin);

  // Routes
  await server.register(healthRoutes, { prefix: '/health' });
  await server.register(projectsRoutes, { prefix: '/projects' });

  return server;
}
