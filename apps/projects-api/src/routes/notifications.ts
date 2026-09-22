import type { FastifyInstance } from 'fastify';
import { mongoStore } from '../repositories/mongoStore';

const publicNotification = (
  record: Awaited<ReturnType<typeof mongoStore.listNotifications>>[number],
) => {
  const { recipientEmail, ...notification } = record;
  void recipientEmail;
  return notification;
};

export default async function notificationRoutes(server: FastifyInstance) {
  server.get(
    '/notifications',
    { preHandler: server.authenticate },
    async (request, reply) => {
      if (!request.currentUser) {
        return reply.code(403).send({ message: 'Compte utilisateur requis.' });
      }
      const notifications = await mongoStore.listNotifications(
        request.currentUser.email,
      );
      return { notifications: notifications.map(publicNotification) };
    },
  );

  server.post(
    '/notifications/read-all',
    { preHandler: server.authenticate },
    async (request, reply) => {
      if (!request.currentUser) {
        return reply.code(403).send({ message: 'Compte utilisateur requis.' });
      }
      await mongoStore.markNotificationsRead(request.currentUser.email);
      return reply.code(204).send();
    },
  );

  server.delete(
    '/notifications/:notificationId',
    { preHandler: server.authenticate },
    async (request, reply) => {
      if (!request.currentUser) {
        return reply.code(403).send({ message: 'Compte utilisateur requis.' });
      }
      const { notificationId } = request.params as { notificationId: string };
      await mongoStore.deleteNotification(
        notificationId,
        request.currentUser.email,
      );
      return reply.code(204).send();
    },
  );
}
