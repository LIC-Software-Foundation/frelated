import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createSeedStore, DEFAULT_SEED_PASSWORD } from '../data/seed';
import { prismaStore } from '../repositories/prismaStore';
import type { ApiUser, AuthSession, StoredUser } from '../domain/models';
import { hashPassword, verifyPassword } from './passwords';
import { issueToken } from './tokens';

const registerSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
  password: z.string().min(8),
  organization: z.string().trim().optional(),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

const toSafeUser = (user: StoredUser): ApiUser => ({
  id: user.id,
  name: user.name,
  email: user.email,
  joinedAt: user.joinedAt,
});

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const ensureUserDatabaseConfigured = () => {
  if (!prismaStore.isEnabled()) {
    throw new Error(
      'La base MySQL des utilisateurs n est pas configuree. Definis DATABASE_URL.',
    );
  }
};

const ensurePrismaSeedUsers = async (): Promise<void> => {
  ensureUserDatabaseConfigured();

  const seedStore = createSeedStore();

  for (const seedUser of seedStore.users) {
    const credentials =
      seedUser.passwordHash && seedUser.passwordSalt
        ? {
            passwordHash: seedUser.passwordHash,
            passwordSalt: seedUser.passwordSalt,
          }
        : hashPassword(DEFAULT_SEED_PASSWORD);

    await prismaStore.seedUserIfMissing({
      id: seedUser.id,
      name: seedUser.name,
      email: normalizeEmail(seedUser.email),
      joinedAt: seedUser.joinedAt,
      organization: seedUser.organization,
      passwordHash: credentials.passwordHash,
      passwordSalt: credentials.passwordSalt,
    });
  }
};

export const authService = {
  async register(input: unknown): Promise<AuthSession> {
    const payload = registerSchema.parse(input);
    const normalizedEmail = normalizeEmail(payload.email);
    await ensurePrismaSeedUsers();
    const existingUser = await prismaStore.findUserByEmail(normalizedEmail);

    if (existingUser) {
      throw new Error('Un compte existe deja avec cette adresse e-mail.');
    }

    const credentials = hashPassword(payload.password);
    const newUser: StoredUser = {
      id: randomUUID(),
      name: payload.name.trim(),
      email: normalizedEmail,
      joinedAt: new Date().toISOString(),
      organization: payload.organization?.trim() || undefined,
      passwordHash: credentials.passwordHash,
      passwordSalt: credentials.passwordSalt,
    };

    await prismaStore.createUser({
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      joinedAt: newUser.joinedAt,
      organization: newUser.organization,
      passwordHash: newUser.passwordHash,
      passwordSalt: newUser.passwordSalt,
    });

    const safeUser = toSafeUser(newUser);
    return {
      user: safeUser,
      token: issueToken({ sub: safeUser.id, email: safeUser.email }),
    };
  },

  async login(input: unknown): Promise<AuthSession> {
    const payload = loginSchema.parse(input);
    const normalizedEmail = normalizeEmail(payload.email);
    await ensurePrismaSeedUsers();
    const candidate = await prismaStore.findUserByEmail(normalizedEmail);

    if (!candidate) {
      throw new Error('Identifiants invalides.');
    }

    const user: StoredUser = {
      id: candidate.id,
      name: candidate.name,
      email: candidate.email,
      joinedAt: candidate.joinedAt,
      organization: candidate.organization || undefined,
      passwordHash: candidate.passwordHash,
      passwordSalt: candidate.passwordSalt,
    };
    const isValid = verifyPassword(
      payload.password,
      user.passwordHash,
      user.passwordSalt,
    );

    if (!isValid) {
      throw new Error('Identifiants invalides.');
    }

    const safeUser = toSafeUser(user);
    return {
      user: safeUser,
      token: issueToken({ sub: safeUser.id, email: safeUser.email }),
    };
  },

  async findUserByEmail(email: string): Promise<ApiUser | null> {
    await ensurePrismaSeedUsers();
    const user = await prismaStore.findUserByEmail(normalizeEmail(email));
    return user
      ? {
          id: user.id,
          name: user.name,
          email: user.email,
          joinedAt: user.joinedAt,
        }
      : null;
  },
};
