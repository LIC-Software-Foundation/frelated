import type { User } from '@frelated/types';
import type { LoginPayload, RegisterPayload } from '../auth.types';
import type { AuthServiceContract } from '../contracts';
import { apiFetch } from './http';
import {
  clearApiSession,
  readApiSession,
  writeApiSession,
} from './sessionStorage';

interface AuthApiResponse {
  token: string;
  user: User;
}

export const authApiService: AuthServiceContract = {
  getSessionUser() {
    return readApiSession()?.user || null;
  },

  async restoreSession() {
    const session = readApiSession();
    if (!session) {
      return null;
    }

    try {
      const response = await apiFetch<{ user: User }>('/auth/me');
      writeApiSession({ ...session, user: response.user });
      return response.user;
    } catch (error) {
      console.warn('Impossible de restaurer la session API', error);
      clearApiSession();
      return null;
    }
  },

  async login(payload: LoginPayload) {
    const session = await apiFetch<AuthApiResponse>('/auth/login', {
      method: 'POST',
      authenticated: false,
      body: JSON.stringify(payload),
    });

    writeApiSession(session);
    return session.user;
  },

  async register(payload: RegisterPayload) {
    const session = await apiFetch<AuthApiResponse>('/auth/register', {
      method: 'POST',
      authenticated: false,
      body: JSON.stringify(payload),
    });

    writeApiSession(session);
    return session.user;
  },

  logout() {
    clearApiSession();
  },
};
