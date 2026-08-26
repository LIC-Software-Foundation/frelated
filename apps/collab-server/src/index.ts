import { createHmac, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http, { IncomingMessage, ServerResponse } from 'node:http';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket, { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import {
  getYDoc as getSharedYDoc,
  setPersistence,
  setupWSConnection,
} from 'y-websocket/bin/utils';

// Resolve paths relative to this file so they are correct regardless of the
// working directory (monorepo root vs apps/collab-server/).
// src/index.ts → go up 1 level → APP_DIR, then up 2 more → ROOT_DIR.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_DIR = path.resolve(__dirname, '..');
const ROOT_DIR = path.resolve(APP_DIR, '../..');

const parseEnvValue = (value: string) => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
};

const loadEnvFile = (filePath: string) => {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = parseEnvValue(line.slice(separatorIndex + 1));

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
};

loadEnvFile(path.join(APP_DIR, '.env'));
loadEnvFile(path.join(APP_DIR, 'src/.env'));
loadEnvFile(path.join(ROOT_DIR, 'apps/projects-api/.env'));
loadEnvFile(path.join(ROOT_DIR, 'apps/projects-api/src/.env'));

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const AUTH_SECRET =
  process.env.AUTH_SECRET || 'frelated-dev-auth-secret-change-me';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';
const PROJECTS_API_URL =
  process.env.PROJECTS_API_URL || 'http://localhost:3000';
const COLLAB_STORE_ROOT =
  process.env.COLLAB_STORE_ROOT ||
  path.join(ROOT_DIR, 'apps/collab-server/.store');
const DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY || AUTH_SECRET;

interface RoomData {
  createdAt: Date;
  connectionCount: number;
  lastActivity: Date;
}

// Room names use the format "{projectId}___{fileId}" so we can reliably
// split on "___" (never present in UUIDs which only contain hex chars and "-").
const parseRoomIds = (
  roomName: string,
): { projectId: string; fileId: string } | null => {
  const separatorIndex = roomName.indexOf('___');
  if (separatorIndex <= 0) return null;
  const projectId = roomName.slice(0, separatorIndex);
  const fileId = roomName.slice(separatorIndex + 3);
  if (!projectId || !fileId) return null;
  return { projectId, fileId };
};

const syncContentToPrisma = async (
  roomName: string,
  doc: Y.Doc,
  attempt = 1,
): Promise<void> => {
  const ids = parseRoomIds(roomName);
  if (!ids) return;

  const content = doc.getText('codemirror').toString();
  const maxAttempts = 5;
  const delayMs = Math.min(1000 * 2 ** (attempt - 1), 16_000);

  try {
    const response = await fetch(
      `${PROJECTS_API_URL}/internal/projects/${ids.projectId}/files/${ids.fileId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-sync-secret': AUTH_SECRET,
        },
        body: JSON.stringify({ content }),
      },
    );

    if (!response.ok) {
      console.warn(
        `[COLLAB] Echec sync Prisma room=${roomName} status=${response.status}`,
      );
    }
  } catch {
    if (attempt < maxAttempts) {
      console.warn(
        `[COLLAB] API indisponible, nouvel essai dans ${delayMs / 1000}s (tentative ${attempt}/${maxAttempts})`,
      );
      setTimeout(
        () => void syncContentToPrisma(roomName, doc, attempt + 1),
        delayMs,
      );
    } else {
      console.warn(
        `[COLLAB] Sync échouée après ${maxAttempts} tentatives room=${roomName}`,
      );
    }
  }
};

interface TokenPayload {
  sub: string;
  email: string;
  exp: number;
}

interface EncryptedValue {
  alg: 'aes-256-gcm';
  iv: string;
  tag: string;
  ciphertext: string;
  keyId: string;
}

const activeRooms = new Map<string, RoomData>();

// ── Notification channel ──────────────────────────────────────────────────────
// Clients connected to /~notify — keyed by user email
const notifClients = new Map<string, WebSocket>();
const NOTIFY_PATH = '/~notify';

const normalizeOrigin = (value: string) => value.replace(/\/+$/u, '');

const configuredOrigins = FRONTEND_ORIGIN.split(',')
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

const decode = (value: string) => Buffer.from(value, 'base64url').toString();
const sign = (payload: string) =>
  createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');

const verifyToken = (token: string): TokenPayload | null => {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return null;

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

const applyCorsHeaders = (response: ServerResponse, origin?: string) => {
  const allowedOrigin = resolveAllowedOrigin(origin);

  response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  response.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization',
  );
  response.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  response.setHeader('Vary', 'Origin');
};

const getRequestUrl = (request: IncomingMessage) =>
  new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

const parseRoomName = (request: IncomingMessage) =>
  getRequestUrl(request).pathname.slice(1) || 'default';

const parseHttpRoomName = (request: IncomingMessage) => {
  const match = getRequestUrl(request).pathname.match(/^\/rooms\/(.+)$/u);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
};

const parseToken = (request: IncomingMessage) => {
  const authorizationHeader = request.headers.authorization;
  if (authorizationHeader?.startsWith('Bearer ')) {
    return authorizationHeader.slice('Bearer '.length).trim();
  }

  return getRequestUrl(request).searchParams.get('token') || '';
};

const deriveScopedKey = (...scope: string[]): Buffer =>
  createHash('sha256')
    .update(`${DATA_ENCRYPTION_KEY}::${scope.join('::')}`, 'utf8')
    .digest();

const toAad = (scope: string[]) => Buffer.from(scope.join('::'), 'utf8');

const encryptBytes = (value: Buffer, ...scope: string[]): EncryptedValue => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveScopedKey(...scope), iv);
  cipher.setAAD(toAad(scope));
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);

  return {
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    keyId: 'v1',
  };
};

const decryptBytes = (payload: EncryptedValue, ...scope: string[]): Buffer => {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveScopedKey(...scope),
    Buffer.from(payload.iv, 'base64'),
  );
  decipher.setAAD(toAad(scope));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]);
};

const getRoomStatePath = (roomName: string) =>
  path.join(
    COLLAB_STORE_ROOT,
    `${roomName.replace(/[^a-zA-Z0-9._-]+/g, '-')}.yjs`,
  );

const ensureStoreRoot = async () => {
  await fsp.mkdir(COLLAB_STORE_ROOT, { recursive: true, mode: 0o700 });
  await fsp.chmod(COLLAB_STORE_ROOT, 0o700).catch(() => undefined);
};

const persistRoomState = async (roomName: string, doc: Y.Doc) => {
  await ensureStoreRoot();
  const statePath = getRoomStatePath(roomName);
  const encodedState = Buffer.from(Y.encodeStateAsUpdate(doc));
  const payload = encryptBytes(encodedState, 'collab-room', roomName);

  await fsp.writeFile(
    statePath,
    JSON.stringify({
      roomName,
      updatedAt: new Date().toISOString(),
      stateEncrypted: payload,
    }),
    { mode: 0o600, encoding: 'utf8' },
  );
  await fsp.chmod(statePath, 0o600).catch(() => undefined);
};

const loadRoomState = async (roomName: string, doc: Y.Doc) => {
  await ensureStoreRoot();
  const statePath = getRoomStatePath(roomName);

  const raw = await fsp.readFile(statePath, 'utf8').catch(() => '');
  if (!raw) {
    return;
  }

  const persisted = JSON.parse(raw) as {
    stateEncrypted?: EncryptedValue;
  };
  if (!persisted.stateEncrypted) {
    return;
  }

  Y.applyUpdate(
    doc,
    decryptBytes(persisted.stateEncrypted, 'collab-room', roomName),
  );
};

setPersistence({
  provider: null,
  bindState: async (roomName: string, doc: Y.Doc) => {
    await loadRoomState(roomName, doc);
    doc.on('update', () => {
      void persistRoomState(roomName, doc);
    });
  },
  writeState: async (roomName: string, doc: Y.Doc) => {
    await persistRoomState(roomName, doc);
  },
});

const ensureRoom = async (roomName: string) => {
  const room = activeRooms.get(roomName) || {
    createdAt: new Date(),
    connectionCount: 0,
    lastActivity: new Date(),
  };

  room.lastActivity = new Date();
  activeRooms.set(roomName, room);
  getSharedYDoc(roomName, true);
  return room;
};

const authenticateRequest = (request: IncomingMessage) => {
  const token = parseToken(request);
  return verifyToken(token);
};

const server = http.createServer(async (request, response) => {
  applyCorsHeaders(response, request.headers.origin);

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = getRequestUrl(request);

  if (request.method === 'GET' && url.pathname === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        status: 'ok',
        rooms: activeRooms.size,
      }),
    );
    return;
  }

  if (request.method === 'PUT' && url.pathname.startsWith('/rooms/')) {
    const payload = authenticateRequest(request);

    if (!payload) {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: 'Authentification requise.' }));
      return;
    }

    const roomName = parseHttpRoomName(request);

    if (!roomName) {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: 'Nom de room invalide.' }));
      return;
    }

    const room = await ensureRoom(roomName);

    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        room: roomName,
        createdAt: room.createdAt.toISOString(),
      }),
    );
    return;
  }

  // Notification push (called by projects-api when a new pending collaborator is added)
  if (request.method === 'POST' && url.pathname === '/internal/notify') {
    const secret = request.headers['x-sync-secret'];
    if (secret !== AUTH_SECRET) {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: 'Unauthorized' }));
      return;
    }

    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on('end', () => {
      try {
        const { recipientEmail, notification } = JSON.parse(body) as {
          recipientEmail: string;
          notification: unknown;
        };
        const clientWs = notifClients.get(recipientEmail);
        const delivered = clientWs?.readyState === WebSocket.OPEN;
        if (delivered && clientWs) {
          clientWs.send(
            JSON.stringify({ type: 'notification', data: notification }),
          );
        }
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ delivered: Boolean(delivered) }));
      } catch {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ message: 'Invalid body' }));
      }
    });
    return;
  }

  response.writeHead(200, { 'Content-Type': 'text/plain' });
  response.end('Frelated collaboration server is running\n');
});

const wss = new WebSocketServer({
  server,
  verifyClient: ({ req }) => {
    const payload = authenticateRequest(req);

    if (!payload) {
      console.warn('[COLLAB] Rejected unauthenticated connection');
      return false;
    }

    return true;
  },
});

wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
  const reqUrl = getRequestUrl(req);

  // ── Notification subscription channel ────────────────────────────────────
  if (reqUrl.pathname === NOTIFY_PATH) {
    const payload = authenticateRequest(req);
    if (!payload) {
      ws.close(4001, 'Unauthorized');
      return;
    }
    notifClients.set(payload.email, ws);
    console.log(`[NOTIFY] ${payload.email} connected`);
    ws.on('close', () => {
      notifClients.delete(payload.email);
      console.log(`[NOTIFY] ${payload.email} disconnected`);
    });
    return;
  }

  // ── Yjs collaboration room ────────────────────────────────────────────────
  const roomName = parseRoomName(req);
  const room = await ensureRoom(roomName);

  room.connectionCount += 1;
  room.lastActivity = new Date();
  activeRooms.set(roomName, room);

  const doc = getSharedYDoc(roomName, true);

  setupWSConnection(ws, req, {
    docName: roomName,
    gc: true,
  });

  ws.on('close', () => {
    const current = activeRooms.get(roomName);
    if (!current) return;

    current.connectionCount -= 1;
    current.lastActivity = new Date();

    if (current.connectionCount <= 0) {
      activeRooms.delete(roomName);
      void persistRoomState(roomName, doc);
      // Persist the final Yjs text content to the database so that users
      // who open the project later get the latest content from the REST API.
      void syncContentToPrisma(roomName, doc);
    }
  });
});

Promise.resolve()
  .then(() => ensureStoreRoot())
  .then(() => {
    server.listen(PORT, HOST, () => {
      console.log(`[COLLAB] ws://${HOST}:${PORT}`);
      console.log(`[COLLAB] Local Yjs store ready: ${COLLAB_STORE_ROOT}`);
    });
  })
  .catch((err) => {
    console.error('[COLLAB] Failed to initialize local Yjs store:', err);
    process.exit(1);
  });

export default server;
