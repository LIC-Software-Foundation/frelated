import type { AppNotification } from '@frelated/types';
import { apiFetch } from './api/http';
import { readApiSession } from './api/sessionStorage';

const STORAGE_KEY = 'frelated_notifications';

type NotificationHandler = (notification: AppNotification) => void;

const handlers = new Set<NotificationHandler>();
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectEnabled = false;

export function loadNotifications(): AppNotification[] {
  try {
    return JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? '[]',
    ) as AppNotification[];
  } catch {
    return [];
  }
}

export function saveNotifications(notifications: AppNotification[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications));
}

export function clearNotifications(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export async function loadServerNotifications(): Promise<AppNotification[]> {
  if (readApiSession()?.kind !== 'user') return [];
  const response = await apiFetch<{ notifications: AppNotification[] }>(
    '/notifications',
  );
  return response.notifications;
}

export async function markServerNotificationsRead(): Promise<void> {
  if (readApiSession()?.kind !== 'user') return;
  await apiFetch<void>('/notifications/read-all', { method: 'POST' });
}

export async function deleteServerNotification(id: string): Promise<void> {
  if (readApiSession()?.kind !== 'user') return;
  await apiFetch<void>(`/notifications/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/** Add a notification directly (mock mode or local dedup). */
export function addLocalNotification(notification: AppNotification): void {
  const stored = loadNotifications();
  if (stored.some((n) => n.id === notification.id)) return;
  const next = [notification, ...stored].slice(0, 100);
  saveNotifications(next);
  handlers.forEach((h) => h(notification));
}

/** Subscribe to incoming notifications. Returns an unsubscribe function. */
export function onNotification(handler: NotificationHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

/** Connect to the collab-server notification channel. */
export function connectNotifications(collabUrl: string, token: string): void {
  disconnectNotifications();
  reconnectEnabled = true;

  // Convert http(s) → ws(s)
  const wsBase = collabUrl.replace(/^http(s?)/, (_m, s: string) => `ws${s}`);
  const wsUrl = `${wsBase}/~notify?token=${encodeURIComponent(token)}`;

  const connect = () => {
    if (!reconnectEnabled) return;
    try {
      const socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        console.log('[NOTIFY] WS connected');
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type: string;
            data: AppNotification;
          };
          if (msg.type === 'notification') {
            addLocalNotification({ ...msg.data, read: false });
          } else if (msg.type === 'access-changed') {
            window.dispatchEvent(
              new CustomEvent('frelated:collaboration-access-changed', {
                detail: msg.data,
              }),
            );
          }
        } catch {
          // ignore malformed messages
        }
      };

      socket.onclose = () => {
        if (!reconnectEnabled) return;
        console.log('[NOTIFY] WS closed — reconnecting in 5s');
        reconnectTimer = setTimeout(connect, 5_000);
      };

      socket.onerror = () => {
        socket.close();
      };

      ws = socket;
    } catch {
      if (reconnectEnabled) {
        reconnectTimer = setTimeout(connect, 5_000);
      }
    }
  };

  connect();
}

/** Disconnect and stop reconnecting. */
export function disconnectNotifications(): void {
  reconnectEnabled = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  ws?.close();
  ws = null;
}
