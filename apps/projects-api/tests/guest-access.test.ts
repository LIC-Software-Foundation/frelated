import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findProjectById: vi.fn(),
  insertGuestInvitation: vi.fn(),
  listGuestInvitations: vi.fn(),
  findGuestInvitationById: vi.fn(),
  findGuestInvitationByTokenHash: vi.fn(),
  updateGuestInvitation: vi.fn(),
  revokeProjectJoinLinks: vi.fn(),
  insertProjectJoinLink: vi.fn(),
  findProjectJoinLinkByTokenHash: vi.fn(),
  sendGuestInvitation: vi.fn(),
}));

vi.mock('../src/repositories/mongoStore', () => ({
  mongoStore: mocks,
}));
vi.mock('../src/services/mail', () => ({
  mailService: { sendGuestInvitation: mocks.sendGuestInvitation },
}));

import { guestAccessService } from '../src/services/guestAccess.service';
import { verifyToken } from '../src/services/tokens';
import { env } from '../src/config/env';

const owner = {
  id: 'owner-id',
  name: 'Owner',
  email: 'owner@example.com',
  joinedAt: '2026-01-01T00:00:00.000Z',
};
const project = {
  id: 'project-a',
  name: 'Article',
  ownerEmail: owner.email,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findProjectById.mockResolvedValue(project);
  mocks.listGuestInvitations.mockResolvedValue([]);
  mocks.insertGuestInvitation.mockResolvedValue(undefined);
  mocks.updateGuestInvitation.mockResolvedValue(true);
  mocks.sendGuestInvitation.mockResolvedValue(undefined);
  env.projectMaxGuestInvitations = 10;
});

afterEach(() => {
  env.projectMaxGuestInvitations = 10;
});

describe('guest invitations', () => {
  it('normalizes email, stores only a hash and sends the raw token by mail', async () => {
    await guestAccessService.createInvitation(owner, project.id, {
      email: ' Guest@Example.COM ',
    });
    const stored = mocks.insertGuestInvitation.mock.calls[0][0];
    const mail = mocks.sendGuestInvitation.mock.calls[0][0];
    const rawToken = String(mail.invitationUrl).split('/').at(-1)!;
    expect(stored.email).toBe('guest@example.com');
    expect(stored.tokenHash).toBe(
      createHash('sha256').update(rawToken).digest('hex'),
    );
    expect(JSON.stringify(stored)).not.toContain(rawToken);
  });

  it('refuses an eleventh active invitation without sending an email', async () => {
    mocks.listGuestInvitations.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => ({
        id: `invitation-${index}`,
        projectId: project.id,
        email: `guest-${index}@example.com`,
        tokenHash: `hash-${index}`,
        role: 'editor' as const,
        status: 'active' as const,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        invitedByUserId: owner.id,
        invitedByEmail: owner.email,
      })),
    );

    await expect(
      guestAccessService.createInvitation(owner, project.id, {
        email: 'eleventh@example.com',
      }),
    ).rejects.toThrow('GUEST_INVITATION_LIMIT');
    expect(mocks.insertGuestInvitation).not.toHaveBeenCalled();
    expect(mocks.sendGuestInvitation).not.toHaveBeenCalled();
  });

  it('revokes the stored invitation when SMTP delivery fails', async () => {
    mocks.sendGuestInvitation.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(
      guestAccessService.createInvitation(owner, project.id, {
        email: 'guest@example.com',
      }),
    ).rejects.toThrow('MAIL_DELIVERY_FAILED');
    const stored = mocks.insertGuestInvitation.mock.calls[0][0];
    expect(mocks.updateGuestInvitation).toHaveBeenCalledWith(
      stored.id,
      expect.objectContaining({ status: 'revoked' }),
    );
  });

  it('issues a project-scoped guest principal and rejects revoked access', async () => {
    const invitation = {
      id: 'invitation-a',
      projectId: project.id,
      email: 'guest@example.com',
      tokenHash: createHash('sha256').update('x'.repeat(32)).digest('hex'),
      role: 'editor' as const,
      status: 'active' as const,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      invitedByUserId: owner.id,
      invitedByEmail: owner.email,
    };
    mocks.findGuestInvitationByTokenHash.mockResolvedValue(invitation);
    const session = await guestAccessService.redeem('x'.repeat(32));
    expect(session.principal).toMatchObject({
      kind: 'guest',
      guestInvitationId: invitation.id,
      projectId: project.id,
    });
    expect(verifyToken(session.token)).toMatchObject({
      kind: 'guest',
      projectId: project.id,
    });

    mocks.findGuestInvitationById.mockResolvedValue({
      ...invitation,
      status: 'revoked',
      revokedAt: new Date().toISOString(),
    });
    await expect(
      guestAccessService.assertActivePrincipal(session.principal),
    ).rejects.toThrow('INVITATION_REVOKED');
  });

  it('revokes by invitation id, never by email', async () => {
    mocks.findGuestInvitationById.mockResolvedValue({
      id: 'invitation-a',
      projectId: project.id,
      email: owner.email,
      tokenHash: 'hash',
      role: 'editor',
      status: 'active',
      createdAt: new Date().toISOString(),
      invitedByUserId: owner.id,
      invitedByEmail: owner.email,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    await guestAccessService.revokeInvitation(
      owner,
      project.id,
      'invitation-a',
    );
    expect(mocks.updateGuestInvitation).toHaveBeenCalledWith(
      'invitation-a',
      expect.objectContaining({ status: 'revoked' }),
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"principalId":"invitation-a"'),
      }),
    );
  });

  it('keeps previously shared project links valid and stores only token hashes', async () => {
    const first = await guestAccessService.createJoinLink(owner, project.id);
    const second = await guestAccessService.createJoinLink(owner, project.id);

    expect(mocks.revokeProjectJoinLinks).not.toHaveBeenCalled();
    expect(first.path).toMatch(/^\/join\/[A-Za-z0-9_-]{32,256}$/u);
    expect(second.path).toMatch(/^\/join\/[A-Za-z0-9_-]{32,256}$/u);
    expect(second.path).not.toBe(first.path);

    const storedTokens = mocks.insertProjectJoinLink.mock.calls.map(
      ([link]) => link.tokenHash,
    );
    const rawTokens = [first.path, second.path].map((path) =>
      path.slice('/join/'.length),
    );
    expect(storedTokens).toEqual(
      rawTokens.map((token) =>
        createHash('sha256').update(token).digest('hex'),
      ),
    );
    expect(
      JSON.stringify(mocks.insertProjectJoinLink.mock.calls),
    ).not.toContain(rawTokens[0]);
  });
});
