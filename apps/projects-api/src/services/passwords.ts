import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;

export const hashPassword = (
  password: string,
  salt = randomBytes(16).toString('hex'),
) => {
  const passwordHash = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return { passwordHash, passwordSalt: salt };
};

export const verifyPassword = (
  password: string,
  passwordHash: string,
  passwordSalt: string,
): boolean => {
  const candidate = scryptSync(password, passwordSalt, KEY_LENGTH);
  const expected = Buffer.from(passwordHash, 'hex');

  if (candidate.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(candidate, expected);
};
