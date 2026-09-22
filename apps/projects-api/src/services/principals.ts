import type { AuthPrincipal, GuestPrincipal } from '../domain/models';
import { authService } from './auth.service';
import { guestAccessService } from './guestAccess.service';
import { verifyToken } from './tokens';

export const resolveTokenPrincipal = async (
  token: string,
): Promise<AuthPrincipal | null> => {
  const payload = verifyToken(token);
  if (!payload) return null;
  if (payload.kind === 'guest') {
    const principal: GuestPrincipal = {
      kind: 'guest',
      guestInvitationId: payload.guestInvitationId,
      projectId: payload.projectId,
      email: payload.email,
      name: payload.name,
    };
    try {
      await guestAccessService.assertActivePrincipal(principal);
      return principal;
    } catch {
      return null;
    }
  }
  const user = await authService.findUserByEmail(payload.email);
  return user
    ? {
        kind: 'user',
        userId: user.id,
        email: user.email,
        name: user.name,
      }
    : null;
};
