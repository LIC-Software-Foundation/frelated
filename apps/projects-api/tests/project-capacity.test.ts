import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { listGuestInvitations } = vi.hoisted(() => ({
  listGuestInvitations: vi.fn(),
}));
vi.mock('../src/repositories/mongoStore', () => ({
  mongoStore: { listGuestInvitations },
}));

import { env } from '../src/config/env';
import { assertProjectParticipantCapacity } from '../src/services/projectCapacity';

const project = {
  id: 'project-a',
  name: 'Article',
  ownerId: 'owner',
  ownerEmail: 'owner@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
  imported: false,
  hasTexFile: true,
  filesIndex: [],
  collaborators: [
    {
      id: 'member-a',
      name: 'Member',
      email: 'member@example.com',
      role: 'editor' as const,
      status: 'approved' as const,
    },
  ],
};

beforeEach(() => {
  env.projectMaxParticipants = 3;
  listGuestInvitations.mockResolvedValue([]);
});

afterEach(() => {
  env.projectMaxParticipants = 0;
  vi.clearAllMocks();
});

it('counts the owner and approved collaborators before accepting a new person', async () => {
  await expect(
    assertProjectParticipantCapacity(project, 'third@example.com'),
  ).resolves.toBeUndefined();
  await expect(
    assertProjectParticipantCapacity(project, 'fourth@example.com'),
  ).resolves.toBeUndefined();
  env.projectMaxParticipants = 2;
  await expect(
    assertProjectParticipantCapacity(project, 'third@example.com'),
  ).rejects.toThrow('PROJECT_PARTICIPANT_LIMIT');
});

it('deduplicates identities by email and counts active guest invitations', async () => {
  listGuestInvitations.mockResolvedValue([
    {
      projectId: project.id,
      email: 'guest@example.com',
      status: 'active',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  ]);
  await expect(
    assertProjectParticipantCapacity(project, 'guest@example.com'),
  ).resolves.toBeUndefined();
  await expect(
    assertProjectParticipantCapacity(project, 'another@example.com'),
  ).rejects.toThrow('PROJECT_PARTICIPANT_LIMIT');
});
