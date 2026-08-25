import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env';

const normalizeOrigin = (value: string) => value.replace(/\/+$/u, '');

const configuredOrigins = env.frontendOrigin
  .split(',')
  .map((value) => normalizeOrigin(value.trim()))
  .filter(Boolean);

const isLoopbackOrigin = (value: string) => {
  try {
    const url = new URL(value);
    return (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '[::1]'
    );
  } catch {
    return false;
  }
};

const resolveAllowedOrigin = (origin?: string) => {
  if (!origin) {
    return configuredOrigins[0] || '*';
  }

  const normalizedOrigin = normalizeOrigin(origin);

  if (
    configuredOrigins.length === 0 ||
    configuredOrigins.includes('*') ||
    configuredOrigins.includes(normalizedOrigin)
  ) {
    return normalizedOrigin;
  }

  const onlyLoopbackConfigured = configuredOrigins.every(isLoopbackOrigin);
  if (onlyLoopbackConfigured && isLoopbackOrigin(normalizedOrigin)) {
    return normalizedOrigin;
  }

  return configuredOrigins[0] || normalizedOrigin;
};

const applyCorsHeaders = (reply: FastifyReply, origin?: string) => {
  const allowedOrigin = resolveAllowedOrigin(origin);

  reply.header('Access-Control-Allow-Origin', allowedOrigin);
  reply.header('Vary', 'Origin');
  reply.header('Access-Control-Allow-Credentials', 'true');
  reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  reply.header(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  );
};

export default fp(async (server) => {
  server.addHook(
    'onRequest',
    async (request: FastifyRequest, reply: FastifyReply) => {
      applyCorsHeaders(reply, request.headers.origin);

      if (request.method === 'OPTIONS') {
        reply.status(204).send();
      }
    },
  );
});
