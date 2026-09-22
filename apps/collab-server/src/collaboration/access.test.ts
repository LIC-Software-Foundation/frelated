import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyCollaborationAccessChange,
  collaborationConnections,
  getCollaborationAccess,
} from './access.js';
import { verifyToken } from '../security/auth.js';
import { env } from '../config/env.js';

const sign = (payload: object) => {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', env.authSecret)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
};

beforeEach(() => collaborationConnections.clear());

describe('structured collaboration principals', () => {
  it('validates a project-scoped guest token', () => {
    const token = sign({
      kind: 'guest',
      sub: 'guest-a',
      guestInvitationId: 'guest-a',
      projectId: 'project-a',
      email: 'guest@example.com',
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    expect(verifyToken(token)).toMatchObject({
      kind: 'guest',
      guestInvitationId: 'guest-a',
      projectId: 'project-a',
    });
  });

  it('asks the API with a structured guest identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access: 'editor' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const access = await getCollaborationAccess('project-a', {
      kind: 'guest',
      sub: 'guest-a',
      guestInvitationId: 'guest-a',
      projectId: 'project-a',
      email: 'guest@example.com',
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    expect(access).toBe('editor');
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get('kind')).toBe('guest');
    expect(url.searchParams.get('id')).toBe('guest-a');
    expect(url.searchParams.get('principalProjectId')).toBe('project-a');
  });

  it('closes only sockets for the revoked guest invitation', () => {
    const guestSocket = { close: vi.fn() };
    const accountSocket = { close: vi.fn() };
    collaborationConnections.add({
      ws: guestSocket as never,
      email: 'same@example.com',
      principalKind: 'guest',
      principalId: 'guest-a',
      projectId: 'project-a',
      access: 'editor',
    });
    collaborationConnections.add({
      ws: accountSocket as never,
      email: 'same@example.com',
      principalKind: 'user',
      principalId: 'user-a',
      projectId: 'project-a',
      access: 'editor',
    });
    expect(
      applyCollaborationAccessChange({
        kind: 'guest',
        projectId: 'project-a',
        principalId: 'guest-a',
        access: 'none',
      }),
    ).toBe(1);
    expect(guestSocket.close).toHaveBeenCalledWith(
      4003,
      'Project access revoked',
    );
    expect(accountSocket.close).not.toHaveBeenCalled();
  });
});
