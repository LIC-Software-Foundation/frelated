import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env';
import type {
  ApiUser,
  GuestInvitationRecord,
  GuestPrincipal,
  ProjectJoinLinkRecord,
} from '../domain/models';
import { mongoStore } from '../repositories/mongoStore';
import { issueGuestToken } from './tokens';
import { mailService } from './mail';
import { assertProjectParticipantCapacity } from './projectCapacity';

const emailSchema = z.string().trim().email().max(320);
const invitationSchema = z.object({ email: emailSchema });
const normalizeEmail = (email: string) => email.trim().toLowerCase();
const tokenHash = (token: string) =>
  createHash('sha256').update(token, 'utf8').digest('hex');
const expirationFromNow = (hours: number) =>
  new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

const isActiveInvitation = (invitation: GuestInvitationRecord, now: number) =>
  invitation.status === 'active' &&
  !invitation.revokedAt &&
  (!invitation.expiresAt || Date.parse(invitation.expiresAt) > now);

const assertGuestInvitationCapacity = async (projectId: string) => {
  const now = Date.now();
  const invitations = await mongoStore.listGuestInvitations(projectId);
  const activeCount = invitations.filter((invitation) =>
    isActiveInvitation(invitation, now),
  ).length;
  if (activeCount >= env.projectMaxGuestInvitations) {
    throw new Error('GUEST_INVITATION_LIMIT');
  }
};

const requireOwner = async (user: ApiUser, projectId: string) => {
  const project = await mongoStore.findProjectById(projectId);
  if (!project) throw new Error('PROJECT_NOT_FOUND');
  if (normalizeEmail(project.ownerEmail) !== normalizeEmail(user.email)) {
    throw new Error('FORBIDDEN');
  }
  return project;
};

const publicInvitation = (invitation: GuestInvitationRecord) => ({
  id: invitation.id,
  projectId: invitation.projectId,
  email: invitation.email,
  role: invitation.role,
  status:
    invitation.status === 'active' &&
    invitation.expiresAt &&
    Date.parse(invitation.expiresAt) <= Date.now()
      ? ('expired' as const)
      : invitation.status,
  createdAt: invitation.createdAt,
  expiresAt: invitation.expiresAt,
  revokedAt: invitation.revokedAt,
  lastUsedAt: invitation.lastUsedAt,
  invitedByUserId: invitation.invitedByUserId,
  invitedByEmail: invitation.invitedByEmail,
});

const assertUsableInvitation = (invitation: GuestInvitationRecord | null) => {
  if (!invitation) throw new Error('INVALID_INVITATION');
  if (invitation.status !== 'active' || invitation.revokedAt) {
    throw new Error('INVITATION_REVOKED');
  }
  if (invitation.expiresAt && Date.parse(invitation.expiresAt) <= Date.now()) {
    throw new Error('INVITATION_EXPIRED');
  }
  return invitation;
};

const notifyGuestRevocation = async (
  projectId: string,
  guestInvitationId: string,
) => {
  await fetch(`${env.collabServerUrl}/internal/access-change`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-sync-secret': env.authSecret,
    },
    body: JSON.stringify({
      kind: 'guest',
      projectId,
      principalId: guestInvitationId,
      access: 'none',
    }),
  }).catch(() => undefined);
};

export const guestAccessService = {
  async createInvitation(user: ApiUser, projectId: string, input: unknown) {
    const { email } = invitationSchema.parse(input);
    const project = await requireOwner(user, projectId);
    await assertGuestInvitationCapacity(projectId);
    await assertProjectParticipantCapacity(project, email);
    const rawToken = randomBytes(32).toString('base64url');
    const now = new Date().toISOString();
    const invitation: GuestInvitationRecord = {
      id: randomUUID(),
      projectId,
      email: normalizeEmail(email),
      tokenHash: tokenHash(rawToken),
      role: 'editor',
      status: 'active',
      createdAt: now,
      expiresAt: expirationFromNow(env.guestInvitationTtlHours),
      invitedByUserId: user.id,
      invitedByEmail: normalizeEmail(user.email),
    };
    await mongoStore.insertGuestInvitation(invitation);
    const invitationUrl = `${env.appPublicUrl.replace(/\/+$/u, '')}/guest/invitations/${rawToken}`;
    try {
      await mailService.sendGuestInvitation({
        to: invitation.email,
        projectName: project.name,
        inviter: user.name || user.email,
        invitationUrl,
        expiresAt: invitation.expiresAt,
      });
    } catch (error) {
      await mongoStore
        .updateGuestInvitation(invitation.id, {
          status: 'revoked',
          revokedAt: new Date().toISOString(),
        })
        .catch(() => undefined);
      throw new Error(
        error instanceof Error && error.message === 'SMTP_NOT_CONFIGURED'
          ? 'SMTP_NOT_CONFIGURED'
          : 'MAIL_DELIVERY_FAILED',
      );
    }
    return publicInvitation(invitation);
  },

  async listInvitations(user: ApiUser, projectId: string) {
    await requireOwner(user, projectId);
    return (await mongoStore.listGuestInvitations(projectId)).map(
      publicInvitation,
    );
  },

  async revokeInvitation(
    user: ApiUser,
    projectId: string,
    invitationId: string,
  ) {
    await requireOwner(user, projectId);
    const invitation = await mongoStore.findGuestInvitationById(invitationId);
    if (!invitation || invitation.projectId !== projectId) {
      throw new Error('INVITATION_NOT_FOUND');
    }
    const revokedAt = new Date().toISOString();
    await mongoStore.updateGuestInvitation(invitationId, {
      status: 'revoked',
      revokedAt,
    });
    await notifyGuestRevocation(projectId, invitationId);
  },

  async redeem(rawToken: string) {
    const token = z.string().min(32).max(256).parse(rawToken);
    const invitation = assertUsableInvitation(
      await mongoStore.findGuestInvitationByTokenHash(tokenHash(token)),
    );
    const project = await mongoStore.findProjectById(invitation.projectId);
    if (!project) throw new Error('PROJECT_NOT_FOUND');
    const lastUsedAt = new Date().toISOString();
    await mongoStore.updateGuestInvitation(invitation.id, { lastUsedAt });
    const name = `Invité — ${invitation.email}`;
    const principal: GuestPrincipal = {
      kind: 'guest',
      guestInvitationId: invitation.id,
      projectId: invitation.projectId,
      email: invitation.email,
      name,
    };
    const tokenTtl = Math.min(
      env.guestSessionTtlHours * 60 * 60,
      invitation.expiresAt
        ? Math.max(
            60,
            Math.floor((Date.parse(invitation.expiresAt) - Date.now()) / 1000),
          )
        : Number.MAX_SAFE_INTEGER,
    );
    return {
      token: issueGuestToken(
        {
          sub: invitation.id,
          guestInvitationId: invitation.id,
          projectId: invitation.projectId,
          email: invitation.email,
          name,
        },
        tokenTtl,
      ),
      principal,
      projectId: invitation.projectId,
    };
  },

  async assertActivePrincipal(principal: GuestPrincipal) {
    const invitation = assertUsableInvitation(
      await mongoStore.findGuestInvitationById(principal.guestInvitationId),
    );
    if (
      invitation.projectId !== principal.projectId ||
      normalizeEmail(invitation.email) !== normalizeEmail(principal.email)
    ) {
      throw new Error('FORBIDDEN');
    }
    return invitation;
  },

  async createJoinLink(user: ApiUser, projectId: string) {
    await requireOwner(user, projectId);
    const now = new Date().toISOString();
    const rawToken = randomBytes(32).toString('base64url');
    const path = `/join/${rawToken}`;
    const link: ProjectJoinLinkRecord = {
      id: randomUUID(),
      projectId,
      tokenHash: tokenHash(rawToken),
      role: 'editor',
      createdAt: now,
      expiresAt: expirationFromNow(env.joinLinkTtlHours),
      createdByUserId: user.id,
    };
    await mongoStore.insertProjectJoinLink(link);
    return {
      path,
      url: `${env.appPublicUrl.replace(/\/+$/u, '')}${path}`,
      expiresAt: link.expiresAt,
    };
  },

  async resolveJoinLink(rawToken: string) {
    const token = z.string().min(32).max(256).parse(rawToken);
    const link = await mongoStore.findProjectJoinLinkByTokenHash(
      tokenHash(token),
    );
    if (
      !link ||
      link.revokedAt ||
      (link.expiresAt && Date.parse(link.expiresAt) <= Date.now())
    ) {
      throw new Error('INVALID_JOIN_LINK');
    }
    return link;
  },
};
