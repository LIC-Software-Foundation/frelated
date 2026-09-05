import type * as Y from 'yjs';
import { env } from '../config/env.js';
import { parseRoomIds } from './rooms.js';

export const syncContentToProjectsApi = async (
  roomName: string,
  doc: Y.Doc,
  attempt = 1,
): Promise<void> => {
  const ids = parseRoomIds(roomName);
  if (!ids) return;
  const maxAttempts = 5;
  const delayMs = Math.min(1000 * 2 ** (attempt - 1), 16_000);
  try {
    const response = await fetch(
      `${env.projectsApiUrl}/internal/projects/${ids.projectId}/files/${ids.fileId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-sync-secret': env.authSecret,
        },
        body: JSON.stringify({ content: doc.getText('codemirror').toString() }),
      },
    );
    if (!response.ok) {
      console.warn(
        `[COLLAB] Sync API failed room=${roomName} status=${response.status}`,
      );
    }
  } catch {
    if (attempt < maxAttempts) {
      console.warn(`[COLLAB] API unavailable, retrying in ${delayMs / 1000}s`);
      setTimeout(
        () => void syncContentToProjectsApi(roomName, doc, attempt + 1),
        delayMs,
      );
    } else {
      console.warn(
        `[COLLAB] Sync failed after ${maxAttempts} attempts room=${roomName}`,
      );
    }
  }
};
