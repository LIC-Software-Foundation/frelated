import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type * as Yjs from 'yjs';
import {
  getYDoc as getSharedYDoc,
  setPersistence,
} from 'y-websocket/bin/utils';
import { env } from '../config/env.js';
import type { RoomData } from './types.js';

// y-websocket/bin/utils is CommonJS and loads the CommonJS Yjs build. Loading
// Yjs through an ESM import as well creates two constructor registries in the
// same process, which Yjs explicitly warns can corrupt type checks.
const require = createRequire(import.meta.url);
const Y = require('yjs') as typeof Yjs;

interface EncryptedValue {
  alg: 'aes-256-gcm';
  iv: string;
  tag: string;
  ciphertext: string;
  keyId: string;
}

export const activeRooms = new Map<string, RoomData>();

export const parseRoomIds = (
  roomName: string,
): { projectId: string; fileId: string } | null => {
  const separatorIndex = roomName.indexOf('___');
  if (separatorIndex <= 0) return null;
  const projectId = roomName.slice(0, separatorIndex);
  const fileId = roomName.slice(separatorIndex + 3);
  return projectId && fileId ? { projectId, fileId } : null;
};

const deriveScopedKey = (...scope: string[]) =>
  createHash('sha256')
    .update(`${env.dataEncryptionKey}::${scope.join('::')}`, 'utf8')
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

const decryptBytes = (payload: EncryptedValue, ...scope: string[]) => {
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
    env.collabStoreRoot,
    `${roomName.replace(/[^a-zA-Z0-9._-]+/g, '-')}.yjs`,
  );

export const ensureStoreRoot = async () => {
  await fsp.mkdir(env.collabStoreRoot, { recursive: true, mode: 0o700 });
  await fsp.chmod(env.collabStoreRoot, 0o700).catch(() => undefined);
};

export const persistRoomState = async (roomName: string, doc: Yjs.Doc) => {
  await ensureStoreRoot();
  const statePath = getRoomStatePath(roomName);
  const stateEncrypted = encryptBytes(
    Buffer.from(Y.encodeStateAsUpdate(doc)),
    'collab-room',
    roomName,
  );
  await fsp.writeFile(
    statePath,
    JSON.stringify({
      roomName,
      updatedAt: new Date().toISOString(),
      stateEncrypted,
    }),
    { mode: 0o600, encoding: 'utf8' },
  );
  await fsp.chmod(statePath, 0o600).catch(() => undefined);
};

const loadRoomState = async (roomName: string, doc: Yjs.Doc) => {
  await ensureStoreRoot();
  const raw = await fsp
    .readFile(getRoomStatePath(roomName), 'utf8')
    .catch(() => '');
  if (!raw) return;
  const persisted = JSON.parse(raw) as { stateEncrypted?: EncryptedValue };
  if (persisted.stateEncrypted) {
    Y.applyUpdate(
      doc,
      decryptBytes(persisted.stateEncrypted, 'collab-room', roomName),
    );
  }
};

export const configureRoomPersistence = () => {
  setPersistence({
    provider: null,
    bindState: async (roomName: string, doc: Yjs.Doc) => {
      await loadRoomState(roomName, doc);
      doc.on('update', () => void persistRoomState(roomName, doc));
    },
    writeState: persistRoomState,
  });
};

export const ensureRoom = async (roomName: string) => {
  const room = activeRooms.get(roomName) || {
    createdAt: new Date(),
    connectionCount: 0,
    lastActivity: new Date(),
  };
  room.lastActivity = new Date();
  activeRooms.set(roomName, room);
  const doc = getSharedYDoc(roomName, true) as Yjs.Doc & {
    whenInitialized?: Promise<void>;
  };
  await doc.whenInitialized;
  return room;
};
