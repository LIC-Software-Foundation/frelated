import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { env } from '../config/env.js';
import { getRequestUrl } from '../http/request.js';

export interface TokenPayload {
  kind?: 'user' | 'guest';
  sub: string;
  email: string;
  guestInvitationId?: string;
  projectId?: string;
  name?: string;
  exp: number;
}

const parseToken = (request: IncomingMessage) => {
  const authorizationHeader = request.headers.authorization;
  if (authorizationHeader?.startsWith('Bearer ')) {
    return authorizationHeader.slice('Bearer '.length).trim();
  }
  return getRequestUrl(request).searchParams.get('token') || '';
};

export const verifyToken = (token: string): TokenPayload | null => {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return null;
  const expected = createHmac('sha256', env.authSecret)
    .update(encodedPayload)
    .digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString(),
    ) as TokenPayload;
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.email !== 'string' ||
      typeof payload.exp !== 'number' ||
      (payload.kind === 'guest' &&
        (!payload.guestInvitationId || !payload.projectId))
    ) {
      return null;
    }
    return payload.exp > Math.floor(Date.now() / 1000) ? payload : null;
  } catch {
    return null;
  }
};

export const authenticateRequest = (request: IncomingMessage) =>
  verifyToken(parseToken(request));
