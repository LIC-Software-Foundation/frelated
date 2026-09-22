import type { GuestInvitation, GuestPrincipal } from '@frelated/types';
import type { ProjectWithFiles } from '../../types';
import { apiFetch } from './http';

export const guestAccessApiService = {
  redeemInvitation(token: string) {
    return apiFetch<{
      token: string;
      principal: GuestPrincipal;
      projectId: string;
    }>('/guest/invitations/redeem', {
      method: 'POST',
      authenticated: false,
      body: JSON.stringify({ token }),
    });
  },
  listInvitations(projectId: string) {
    return apiFetch<{
      invitations: GuestInvitation[];
      maximumActiveInvitations: number;
    }>(`/projects/${encodeURIComponent(projectId)}/guest-invitations`);
  },
  createInvitation(projectId: string, email: string) {
    return apiFetch<{ invitation: GuestInvitation }>(
      `/projects/${encodeURIComponent(projectId)}/guest-invitations`,
      { method: 'POST', body: JSON.stringify({ email }) },
    ).then((response) => response.invitation);
  },
  revokeInvitation(projectId: string, invitationId: string) {
    return apiFetch<void>(
      `/projects/${encodeURIComponent(projectId)}/guest-invitations/${encodeURIComponent(invitationId)}`,
      { method: 'DELETE' },
    );
  },
  createJoinLink(projectId: string) {
    return apiFetch<{ url: string; path?: string; expiresAt?: string }>(
      `/projects/${encodeURIComponent(projectId)}/join-links`,
      { method: 'POST' },
    );
  },
  redeemJoinLink(token: string) {
    return apiFetch<{ project: ProjectWithFiles }>('/join/redeem', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },
};
