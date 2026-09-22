import { env } from '../config/env';
import type { MongoProjectRecord } from '../repositories/mongoStore';
import { mongoStore } from '../repositories/mongoStore';
import type { ProjectCollaborator } from '../domain/models';

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const assertProjectParticipantCapacity = async (
  project: MongoProjectRecord,
  incomingEmail: string | string[],
  collaborators: ProjectCollaborator[] = project.collaborators ?? [],
) => {
  if (env.projectMaxParticipants === 0) return;

  const participantEmails = new Set<string>([
    normalizeEmail(project.ownerEmail),
  ]);
  for (const collaborator of collaborators) {
    if (collaborator.status !== 'pending') {
      participantEmails.add(normalizeEmail(collaborator.email));
    }
  }
  const now = Date.now();
  for (const invitation of await mongoStore.listGuestInvitations(project.id)) {
    if (
      invitation.status === 'active' &&
      !invitation.revokedAt &&
      (!invitation.expiresAt || Date.parse(invitation.expiresAt) > now)
    ) {
      participantEmails.add(normalizeEmail(invitation.email));
    }
  }

  const incomingEmails = Array.isArray(incomingEmail)
    ? incomingEmail
    : [incomingEmail];
  incomingEmails.forEach((email) =>
    participantEmails.add(normalizeEmail(email)),
  );
  if (participantEmails.size > env.projectMaxParticipants) {
    throw new Error('PROJECT_PARTICIPANT_LIMIT');
  }
};
