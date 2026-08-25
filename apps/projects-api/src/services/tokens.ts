import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

interface TokenPayload {
  sub: string;
  email: string;
  exp: number;
}

const encode = (value: string) => Buffer.from(value).toString('base64url');
const decode = (value: string) => Buffer.from(value, 'base64url').toString();

const sign = (payload: string) =>
  createHmac('sha256', env.authSecret).update(payload).digest('base64url');

export const issueToken = (payload: Omit<TokenPayload, 'exp'>): string => {
  const tokenPayload: TokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
  };
  const encodedPayload = encode(JSON.stringify(tokenPayload));
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
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

  const payload = JSON.parse(decode(encodedPayload)) as TokenPayload;

  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
};
