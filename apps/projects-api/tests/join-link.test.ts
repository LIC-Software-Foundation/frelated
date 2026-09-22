import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findProjectById: vi.fn(),
  readProjectFiles: vi.fn(),
  updateProject: vi.fn(),
  insertNotification: vi.fn(),
}));

vi.mock('../src/repositories/mongoStore', () => ({
  mongoStore: {
    isEnabled: () => true,
    ...mocks,
  },
}));

import { projectsService } from '../src/services/projects.service';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  mocks.readProjectFiles.mockResolvedValue([]);
  mocks.findProjectById.mockResolvedValue({
    id: 'project-a',
    name: 'Article',
    ownerId: 'owner',
    ownerEmail: 'owner@example.com',
    createdAt: new Date().toISOString(),
    imported: false,
    hasTexFile: true,
    filesIndex: [],
    collaborators: [
      {
        id: 'pending-a',
        name: 'Old name',
        email: 'member@example.com',
        role: 'viewer',
        status: 'pending',
      },
    ],
  });
});

it('turns a valid join-link visitor directly into an approved editor', async () => {
  const project = await projectsService.addApprovedCollaborator(
    {
      id: 'member',
      name: 'Member',
      email: 'member@example.com',
      joinedAt: new Date().toISOString(),
    },
    'project-a',
  );
  expect(project.collaborators[0]).toMatchObject({
    email: 'member@example.com',
    role: 'editor',
    status: 'approved',
  });
  expect(mocks.updateProject).toHaveBeenCalledWith(
    'project-a',
    expect.objectContaining({
      collaborators: expect.arrayContaining([
        expect.objectContaining({ role: 'editor', status: 'approved' }),
      ]),
    }),
  );
  expect(mocks.insertNotification).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'collaborator_joined',
      recipientEmail: 'owner@example.com',
      collaboratorId: 'pending-a',
    }),
  );
});
