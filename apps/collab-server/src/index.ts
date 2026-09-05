import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import {
  getYDoc as getSharedYDoc,
  setupWSConnection,
} from 'y-websocket/bin/utils';
import {
  asPermissionFilteredSocket,
  collaborationConnections,
  getCollaborationAccess,
} from './collaboration/access.js';
import {
  activeRooms,
  configureRoomPersistence,
  ensureRoom,
  ensureStoreRoot,
  parseRoomIds,
  persistRoomState,
} from './collaboration/rooms.js';
import { syncContentToProjectsApi } from './collaboration/sync.js';
import type { CollaborationAccess } from './collaboration/types.js';
import { env } from './config/env.js';
import {
  applyCorsHeaders,
  getRequestUrl,
  parseHttpRoomName,
  parseRoomName,
} from './http/request.js';
import { authenticateRequest } from './security/auth.js';

const NOTIFY_PATH = '/~notify';
const notificationClients = new Map<string, WebSocket>();

const readJsonBody = <T>(request: IncomingMessage): Promise<T> =>
  new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(body) as T);
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });

const sendJson = (
  response: ServerResponse,
  status: number,
  payload: unknown,
) => {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(payload));
};

const handleRoomPreparation = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  const payload = authenticateRequest(request);
  if (!payload)
    return sendJson(response, 401, { message: 'Authentification requise.' });
  const roomName = parseHttpRoomName(request);
  const ids = parseRoomIds(roomName);
  if (!ids)
    return sendJson(response, 400, { message: 'Nom de room invalide.' });
  const access = await getCollaborationAccess(ids.projectId, payload.email);
  if (access === 'none') {
    return sendJson(response, 403, { message: 'Acces au projet refuse.' });
  }
  const room = await ensureRoom(roomName);
  sendJson(response, 200, {
    room: roomName,
    createdAt: room.createdAt.toISOString(),
  });
};

const handleNotification = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  if (request.headers['x-sync-secret'] !== env.authSecret) {
    return sendJson(response, 401, { message: 'Unauthorized' });
  }
  try {
    const { recipientEmail, notification } = await readJsonBody<{
      recipientEmail: string;
      notification: unknown;
    }>(request);
    const client = notificationClients.get(recipientEmail.toLowerCase());
    const delivered = client?.readyState === WebSocket.OPEN;
    if (delivered) {
      client.send(JSON.stringify({ type: 'notification', data: notification }));
    }
    sendJson(response, 200, { delivered: Boolean(delivered) });
  } catch {
    sendJson(response, 400, { message: 'Invalid body' });
  }
};

const isCollaborationAccess = (value: unknown): value is CollaborationAccess =>
  value === 'none' || value === 'viewer' || value === 'editor';

const handleAccessChange = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  if (request.headers['x-sync-secret'] !== env.authSecret) {
    return sendJson(response, 401, { message: 'Unauthorized' });
  }
  try {
    const change = await readJsonBody<{
      projectId?: string;
      email?: string;
      access?: unknown;
    }>(request);
    if (
      !change.projectId ||
      !change.email ||
      !isCollaborationAccess(change.access)
    ) {
      return sendJson(response, 400, { message: 'Invalid body' });
    }
    let updated = 0;
    for (const connection of collaborationConnections) {
      if (
        connection.projectId === change.projectId &&
        connection.email.toLowerCase() === change.email.toLowerCase()
      ) {
        updated += 1;
        if (change.access === 'none') {
          connection.ws.close(4003, 'Project access revoked');
        } else {
          connection.access = change.access;
        }
      }
    }
    const notificationClient = notificationClients.get(
      change.email.toLowerCase(),
    );
    if (notificationClient?.readyState === WebSocket.OPEN) {
      notificationClient.send(
        JSON.stringify({
          type: 'access-changed',
          data: { projectId: change.projectId, access: change.access },
        }),
      );
    }
    sendJson(response, 200, { updated });
  } catch {
    sendJson(response, 400, { message: 'Invalid body' });
  }
};

configureRoomPersistence();

const server = http.createServer(async (request, response) => {
  applyCorsHeaders(response, request.headers.origin);
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    return response.end();
  }
  const url = getRequestUrl(request);
  if (request.method === 'GET' && url.pathname === '/health') {
    return sendJson(response, 200, { status: 'ok', rooms: activeRooms.size });
  }
  if (request.method === 'PUT' && url.pathname.startsWith('/rooms/')) {
    return handleRoomPreparation(request, response);
  }
  if (request.method === 'POST' && url.pathname === '/internal/notify') {
    return handleNotification(request, response);
  }
  if (request.method === 'POST' && url.pathname === '/internal/access-change') {
    return handleAccessChange(request, response);
  }
  response.writeHead(200, { 'Content-Type': 'text/plain' });
  response.end('Frelated collaboration server is running\n');
});

const wss = new WebSocketServer({
  server,
  verifyClient: ({ req }) => Boolean(authenticateRequest(req)),
});

const subscribeToNotifications = (ws: WebSocket, request: IncomingMessage) => {
  const payload = authenticateRequest(request);
  if (!payload) return ws.close(4001, 'Unauthorized');
  const email = payload.email.toLowerCase();
  notificationClients.set(email, ws);
  console.log(`[NOTIFY] ${payload.email} connected`);
  ws.on('close', () => {
    if (notificationClients.get(email) === ws)
      notificationClients.delete(email);
    console.log(`[NOTIFY] ${payload.email} disconnected`);
  });
};

const subscribeToRoom = async (ws: WebSocket, request: IncomingMessage) => {
  const roomName = parseRoomName(request);
  const ids = parseRoomIds(roomName);
  const payload = authenticateRequest(request);
  if (!ids || !payload) return ws.close(4001, 'Invalid collaboration room');
  const access = await getCollaborationAccess(ids.projectId, payload.email);
  if (access === 'none') return ws.close(4003, 'Project access denied');

  const room = await ensureRoom(roomName);
  room.connectionCount += 1;
  room.lastActivity = new Date();
  const doc = getSharedYDoc(roomName, true);
  const connection = {
    ws,
    email: payload.email,
    projectId: ids.projectId,
    access,
  };
  collaborationConnections.add(connection);
  setupWSConnection(asPermissionFilteredSocket(connection), request, {
    docName: roomName,
    gc: true,
  });

  ws.on('close', () => {
    collaborationConnections.delete(connection);
    const current = activeRooms.get(roomName);
    if (!current) return;
    current.connectionCount -= 1;
    current.lastActivity = new Date();
    if (current.connectionCount <= 0) {
      activeRooms.delete(roomName);
      void persistRoomState(roomName, doc);
      void syncContentToProjectsApi(roomName, doc);
    }
  });
};

wss.on('connection', (ws, request) => {
  if (getRequestUrl(request).pathname === NOTIFY_PATH) {
    subscribeToNotifications(ws, request);
  } else {
    void subscribeToRoom(ws, request);
  }
});

ensureStoreRoot()
  .then(() => {
    server.listen(env.port, env.host, () => {
      console.log(`[COLLAB] ws://${env.host}:${env.port}`);
      console.log(`[COLLAB] Local Yjs store ready: ${env.collabStoreRoot}`);
    });
  })
  .catch((error) => {
    console.error('[COLLAB] Failed to initialize local Yjs store:', error);
    process.exit(1);
  });

export default server;
