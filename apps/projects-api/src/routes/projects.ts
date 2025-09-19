import { FastifyInstance } from 'fastify';

export default async function projectsRoutes(server: FastifyInstance) {
  server.get(
    '/',
    {
      schema: {
        description: 'List all projects',
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number' },
                name: { type: 'string' },
              },
            },
          },
        },
      },
    },
    async () => {
      return server.prisma.project.findMany();
    },
  );

  server.post(
    '/upload',
    {
      schema: {
        consumes: ['multipart/form-data'],
        body: {
          type: 'object',
          properties: {
            file: { type: 'string', format: 'binary' },
          },
        },
      },
    },
    async (req, reply) => {
      const data = await req.file(); // requires @fastify/multipart
      const uploadStream = server.mongo.bucket.openUploadStream(data.filename);
      data.file.pipe(uploadStream);
      // To remove
      reply.getHeader('accept');
      return { uploaded: true, filename: data.filename };
    },
  );
}
