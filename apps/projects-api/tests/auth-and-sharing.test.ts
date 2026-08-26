import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Projects API auth and sharing flow', () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  afterEach(async () => {
    vi.resetModules();
  });

  it('allows a second authenticated user to access a shared project', async () => {
    const { buildServer } = await import('../src/buildServer');
    const app = await buildServer();

    const ownerLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'regent@frelated.dev',
        password: 'frelated123',
      },
    });

    expect(ownerLogin.statusCode).toBe(200);
    const ownerSession = ownerLogin.json() as {
      token: string;
      user: { email: string };
    };

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: {
        authorization: `Bearer ${ownerSession.token}`,
      },
      payload: {
        name: 'Projet partage',
      },
    });

    expect(createProject.statusCode).toBe(201);
    const createdProject = createProject.json() as {
      project: { id: string; owner: string };
    };

    const collaboratorRegister = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'Collaborateur Test',
        email: 'collaborateur@frelated.dev',
        password: 'collab1234',
      },
    });

    expect(collaboratorRegister.statusCode).toBe(200);
    const collaboratorSession = collaboratorRegister.json() as {
      token: string;
    };

    const sharedAccess = await app.inject({
      method: 'GET',
      url: `/projects/shared/${encodeURIComponent(createdProject.project.owner)}/${createdProject.project.id}`,
      headers: {
        authorization: `Bearer ${collaboratorSession.token}`,
      },
    });

    expect(sharedAccess.statusCode).toBe(200);
    const sharedProject = sharedAccess.json() as {
      project: {
        collaborators: Array<{ email: string }>;
      };
    };

    expect(
      sharedProject.project.collaborators.some(
        (collaborator) => collaborator.email === 'collaborateur@frelated.dev',
      ),
    ).toBe(true);

    await app.close();
  });
});
