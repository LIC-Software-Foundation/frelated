import seedAuthUsers from '../data/auth-users.json';
import { User } from '@frelated/types';
import type { LoginPayload, RegisterPayload } from './auth.types';

const MOCK_USERS_STORAGE_KEY = 'frelated-mock-auth-users';
const SESSION_STORAGE_KEY = 'frelated-mock-session';

interface MockAuthUserRecord extends User {
  password: string;
  organization?: string;
}

const delay = (ms: number) =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const toSafeUser = (user: MockAuthUserRecord): User => ({
  id: user.id,
  name: user.name,
  email: user.email,
  joinedAt: user.joinedAt,
});

const readStoredUsers = (): MockAuthUserRecord[] => {
  const raw = localStorage.getItem(MOCK_USERS_STORAGE_KEY);
  if (!raw) return [];

  try {
    return JSON.parse(raw) as MockAuthUserRecord[];
  } catch (error) {
    console.warn('Impossible de lire les comptes mockés', error);
    return [];
  }
};

const writeStoredUsers = (users: MockAuthUserRecord[]) => {
  localStorage.setItem(MOCK_USERS_STORAGE_KEY, JSON.stringify(users));
};

const getSeedUsers = (): MockAuthUserRecord[] =>
  (seedAuthUsers.users as MockAuthUserRecord[]).map((user) => ({
    ...user,
    email: normalizeEmail(user.email),
  }));

const getAllUsers = (): MockAuthUserRecord[] => {
  const merged = new Map<string, MockAuthUserRecord>();

  for (const user of [...getSeedUsers(), ...readStoredUsers()]) {
    merged.set(normalizeEmail(user.email), {
      ...user,
      email: normalizeEmail(user.email),
    });
  }

  return Array.from(merged.values());
};

const persistSession = (user: User) => {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
};

export const getSessionUser = (): User | null => {
  const raw = localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as User;
  } catch (error) {
    console.warn('Impossible de lire la session mockée', error);
    return null;
  }
};

export const restoreSession = async (): Promise<User | null> =>
  getSessionUser();

export const logout = () => {
  localStorage.removeItem(SESSION_STORAGE_KEY);
};

export const login = async ({
  email,
  password,
}: LoginPayload): Promise<User> => {
  await delay(900);

  const normalizedEmail = normalizeEmail(email);
  const user = getAllUsers().find((entry) => entry.email === normalizedEmail);

  if (!user || user.password !== password) {
    throw new Error(
      'Identifiants invalides. Essayez amina@frelated.dev / frelated123.',
    );
  }

  const safeUser = toSafeUser(user);
  persistSession(safeUser);
  return safeUser;
};

export const register = async ({
  name,
  email,
  password,
  organization,
}: RegisterPayload): Promise<User> => {
  await delay(1100);

  const normalizedEmail = normalizeEmail(email);
  const trimmedName = name.trim();

  if (!trimmedName) {
    throw new Error('Le nom complet est requis.');
  }

  if (password.trim().length < 8) {
    throw new Error('Le mot de passe doit contenir au moins 8 caractères.');
  }

  const existingUser = getAllUsers().find(
    (entry) => entry.email === normalizedEmail,
  );
  if (existingUser) {
    throw new Error('Un compte existe déjà avec cette adresse e-mail.');
  }

  const newUser: MockAuthUserRecord = {
    id: crypto.randomUUID(),
    name: trimmedName,
    email: normalizedEmail,
    password,
    joinedAt: new Date().toISOString(),
    organization: organization?.trim() || undefined,
  };

  writeStoredUsers([...readStoredUsers(), newUser]);

  const safeUser = toSafeUser(newUser);
  persistSession(safeUser);
  return safeUser;
};
