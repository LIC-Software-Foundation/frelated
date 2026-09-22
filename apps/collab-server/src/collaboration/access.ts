import WebSocket from 'ws';
import { env } from '../config/env.js';
import type { CollaborationAccess, CollaborationConnection } from './types.js';
import type { TokenPayload } from '../security/auth.js';

export const collaborationConnections = new Set<CollaborationConnection>();

export type CollaborationAccessChange =
  | {
      kind?: 'user';
      projectId: string;
      email: string;
      access: CollaborationAccess;
    }
  | {
      kind: 'guest';
      projectId: string;
      principalId: string;
      access: CollaborationAccess;
    };

export const applyCollaborationAccessChange = (
  change: CollaborationAccessChange,
): number => {
  let updated = 0;
  for (const connection of collaborationConnections) {
    const matches =
      connection.projectId === change.projectId &&
      (change.kind === 'guest'
        ? connection.principalKind === 'guest' &&
          connection.principalId === change.principalId
        : connection.principalKind === 'user' &&
          connection.email.toLowerCase() === change.email.toLowerCase());
    if (!matches) continue;
    updated += 1;
    if (change.access === 'none') {
      connection.ws.close(4003, 'Project access revoked');
    } else {
      connection.access = change.access;
    }
  }
  return updated;
};

export const getCollaborationAccess = async (
  projectId: string,
  principal: TokenPayload,
): Promise<CollaborationAccess> => {
  try {
    const url = new URL(
      `/internal/projects/${encodeURIComponent(projectId)}/collaboration-access`,
      env.projectsApiUrl,
    );
    url.searchParams.set('email', principal.email);
    url.searchParams.set('kind', principal.kind === 'guest' ? 'guest' : 'user');
    url.searchParams.set(
      'id',
      principal.kind === 'guest'
        ? (principal.guestInvitationId ?? '')
        : principal.sub,
    );
    if (principal.kind === 'guest') {
      url.searchParams.set('principalProjectId', principal.projectId ?? '');
    }
    const response = await fetch(url, {
      headers: { 'x-sync-secret': env.authSecret },
    });
    if (!response.ok) return 'none';
    const body = (await response.json()) as { access?: CollaborationAccess };
    return body.access === 'viewer' || body.access === 'editor'
      ? body.access
      : 'none';
  } catch (error) {
    console.warn('[COLLAB] Permission check failed', error);
    return 'none';
  }
};

const readVarUint = (bytes: Uint8Array, offset: number) => {
  let value = 0;
  let shift = 0;
  let index = offset;
  while (index < bytes.length) {
    const byte = bytes[index++];
    value |= (byte & 0x7f) << shift;
    if (byte < 0x80) return { value, offset: index };
    shift += 7;
  }
  return null;
};

export const isYjsDocumentWrite = (data: WebSocket.RawData): boolean => {
  const buffer = Array.isArray(data)
    ? Buffer.concat(data)
    : data instanceof ArrayBuffer
      ? Buffer.from(data)
      : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const message = readVarUint(buffer, 0);
  if (!message || message.value !== 0) return false;
  const syncMessage = readVarUint(buffer, message.offset);
  return syncMessage?.value === 1 || syncMessage?.value === 2;
};

export const asPermissionFilteredSocket = (
  connection: CollaborationConnection,
): WebSocket =>
  new Proxy(connection.ws, {
    get(target, property) {
      if (property === 'on') {
        return (event: string, listener: (...args: unknown[]) => void) => {
          if (event !== 'message') {
            target.on(event, listener as never);
          } else {
            target.on('message', (data, isBinary) => {
              if (connection.access === 'editor' || !isYjsDocumentWrite(data)) {
                listener(data, isBinary);
              }
            });
          }
          return connection.ws;
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, property, value) {
      return Reflect.set(target, property, value, target);
    },
  });
