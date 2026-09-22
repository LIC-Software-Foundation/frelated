import type { GuestPrincipal, User, UserPrincipal } from '@frelated/types';

const API_SESSION_STORAGE_KEY = 'frelated-api-session';
const GUEST_SESSION_STORAGE_KEY = 'frelated-guest-session';

export interface AuthenticatedApiSession {
  kind: 'user';
  token: string;
  user: User;
  principal: UserPrincipal;
}

export interface GuestApiSession {
  kind: 'guest';
  token: string;
  principal: GuestPrincipal;
}

export type ApiSessionStorageValue = AuthenticatedApiSession | GuestApiSession;

export const readApiSession = (): ApiSessionStorageValue | null => {
  const guestRaw = sessionStorage.getItem(GUEST_SESSION_STORAGE_KEY);
  if (guestRaw) {
    try {
      return JSON.parse(guestRaw) as GuestApiSession;
    } catch {
      sessionStorage.removeItem(GUEST_SESSION_STORAGE_KEY);
    }
  }
  const raw = localStorage.getItem(API_SESSION_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<AuthenticatedApiSession> & {
      token?: string;
      user?: User;
    };
    if (!parsed.token || !parsed.user) return null;
    return {
      kind: 'user',
      token: parsed.token,
      user: parsed.user,
      principal: parsed.principal ?? {
        kind: 'user',
        userId: parsed.user.id,
        email: parsed.user.email,
        name: parsed.user.name,
      },
    };
  } catch {
    return null;
  }
};

export const writeApiSession = (
  session: Pick<AuthenticatedApiSession, 'token' | 'user'>,
): void => {
  const value: AuthenticatedApiSession = {
    ...session,
    kind: 'user',
    principal: {
      kind: 'user',
      userId: session.user.id,
      email: session.user.email,
      name: session.user.name,
    },
  };
  sessionStorage.removeItem(GUEST_SESSION_STORAGE_KEY);
  localStorage.setItem(API_SESSION_STORAGE_KEY, JSON.stringify(value));
};

export const writeGuestApiSession = (session: GuestApiSession): void => {
  localStorage.removeItem(API_SESSION_STORAGE_KEY);
  sessionStorage.setItem(GUEST_SESSION_STORAGE_KEY, JSON.stringify(session));
};

export const clearApiSession = (): void => {
  localStorage.removeItem(API_SESSION_STORAGE_KEY);
  sessionStorage.removeItem(GUEST_SESSION_STORAGE_KEY);
};
