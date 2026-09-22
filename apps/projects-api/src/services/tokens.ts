import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

export interface UserTokenPayload {
  kind?: 'user';
  sub: string;
  email: string;
  exp: number;
}

export interface GuestTokenPayload {
  kind: 'guest';
  sub: string;
  guestInvitationId: string;
  projectId: string;
  email: string;
  name: string;
  exp: number;
}

export type TokenPayload = UserTokenPayload | GuestTokenPayload;

const encode = (value: string) => Buffer.from(value).toString('base64url');
const decode = (value: string) => Buffer.from(value, 'base64url').toString();

const sign = (payload: string) =>
  createHmac('sha256', env.authSecret).update(payload).digest('base64url');

export const issueToken = (
  payload: Omit<UserTokenPayload, 'exp' | 'kind'>,
): string => {
  const tokenPayload: UserTokenPayload = {
    ...payload,
    kind: 'user',
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
  };
  const encodedPayload = encode(JSON.stringify(tokenPayload));
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
};

export const issueGuestToken = (
  payload: Omit<GuestTokenPayload, 'exp' | 'kind'>,
  ttlSeconds: number,
): string => {
  const tokenPayload: GuestTokenPayload = {
    ...payload,
    kind: 'guest',
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encodedPayload = encode(JSON.stringify(tokenPayload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
};

export const verifyToken = (token: string): TokenPayload | null => {
  const [encodedPayload, signature] = token.split('.');

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = sign(encodedPayload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (actualBuffer.length !== expectedBuffer.length) {
    return null;
  }

  if (!timingSafeEqual(actualBuffer, expectedBuffer)) {
    return null;
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(decode(encodedPayload)) as TokenPayload;
  } catch {
    return null;
  }

  if (
    typeof payload.exp !== 'number' ||
    typeof payload.email !== 'string' ||
    typeof payload.sub !== 'string' ||
    payload.exp <= Math.floor(Date.now() / 1000)
  ) {
    return null;
  }

  return payload;
};
