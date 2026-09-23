import http, { type Server } from 'node:http';
import type { AutoscalerService } from '../services/autoscalerService.js';

/**
 * Minimal HTTP server exposing liveness/status for the Docker healthcheck
 * and for humans debugging the fleet. Mirrors the plain `node:http` style
 * already used by `apps/collab-server/src/index.ts` rather than pulling in
 * a web framework for two read-only endpoints.
 */
export function createHealthServer(autoscaler: AutoscalerService): Server {
  return http.createServer((request, response) => {
    if (request.method !== 'GET') {
      response.writeHead(405, { 'Content-Type': 'application/json' });
      return response.end(JSON.stringify({ message: 'Method not allowed' }));
    }

    if (request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      return response.end(JSON.stringify({ status: 'ok' }));
    }

    if (request.url === '/status') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      return response.end(JSON.stringify(autoscaler.getStatus()));
    }

    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ message: 'Not found' }));
  });
}
