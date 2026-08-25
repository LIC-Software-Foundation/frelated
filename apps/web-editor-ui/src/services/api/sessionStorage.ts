import type { User } from '@frelated/types';

const API_SESSION_STORAGE_KEY = 'frelated-api-session';

export interface ApiSessionStorageValue {
  token: string;
  user: User;
}

export const readApiSession = (): ApiSessionStorageValue | null => {
  const raw = localStorage.getItem(API_SESSION_STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as ApiSessionStorageValue;
  } catch {
    return null;
  }
};

export const writeApiSession = (session: ApiSessionStorageValue): void => {
  localStorage.setItem(API_SESSION_STORAGE_KEY, JSON.stringify(session));
};

export const clearApiSession = (): void => {
  localStorage.removeItem(API_SESSION_STORAGE_KEY);
};
