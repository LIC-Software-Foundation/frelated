import fp from 'fastify-plugin';
import { MongoClient, Db, GridFSBucket } from 'mongodb';

export default fp(async (server) => {
  const url = process.env.MONGODB_URL || 'mongodb://localhost:27017';
  const dbName = process.env.MONGODB_DB || 'frelated';

  const client = new MongoClient(url);
  await client.connect();

  const db: Db = client.db(dbName);
  const bucket = new GridFSBucket(db);

  server.decorate('mongo', { client, db, bucket });

  server.addHook('onClose', async () => {
    await client.close();
  });
});

declare module 'fastify' {
  interface FastifyInstance {
    mongo: {
      client: MongoClient;
      db: Db;
      bucket: GridFSBucket;
    };
  }
}
