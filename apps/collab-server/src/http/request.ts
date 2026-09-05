import type { IncomingMessage, ServerResponse } from 'node:http';
import { env } from '../config/env.js';

export const getRequestUrl = (request: IncomingMessage) =>
  new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

export const parseRoomName = (request: IncomingMessage) =>
  getRequestUrl(request).pathname.slice(1) || 'default';

export const parseHttpRoomName = (request: IncomingMessage) => {
  const match = getRequestUrl(request).pathname.match(/^\/rooms\/(.+)$/u);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
};

const normalizeOrigin = (value: string) => value.replace(/\/+$/u, '');
const configuredOrigins = env.frontendOrigin
  .split(',')
  .map((value) => normalizeOrigin(value.trim()))
  .filter(Boolean);

const isLoopbackOrigin = (value: string) => {
  try {
    const url = new URL(value);
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
};

const resolveAllowedOrigin = (origin?: string) => {
  if (!origin) return configuredOrigins[0] || '*';
  const normalizedOrigin = normalizeOrigin(origin);
  if (
    configuredOrigins.length === 0 ||
    configuredOrigins.includes('*') ||
    configuredOrigins.includes(normalizedOrigin)
  ) {
    return normalizedOrigin;
  }
  if (configuredOrigins.every(isLoopbackOrigin) && isLoopbackOrigin(origin)) {
    return normalizedOrigin;
  }
  return configuredOrigins[0] || normalizedOrigin;
};

export const applyCorsHeaders = (response: ServerResponse, origin?: string) => {
  response.setHeader(
    'Access-Control-Allow-Origin',
    resolveAllowedOrigin(origin),
  );
  response.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization',
  );
  response.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  response.setHeader('Vary', 'Origin');
};
