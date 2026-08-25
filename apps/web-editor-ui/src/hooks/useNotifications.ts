import { useCallback, useEffect, useState } from 'react';
import type { AppNotification } from '@frelated/types';
import {
  addLocalNotification,
  loadNotifications,
  onNotification,
  saveNotifications,
} from '../services/notificationService';

export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>(() =>
    loadNotifications(),
  );

  // Subscribe to real-time pushes (from WS or mock)
  useEffect(() => {
    // Sync with localStorage in case another tab wrote notifications
    setNotifications(loadNotifications());

    return onNotification((notification) => {
      setNotifications((prev) => {
        if (prev.some((n) => n.id === notification.id)) return prev;
        return [notification, ...prev];
      });
    });
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAsRead = useCallback((id: string) => {
    setNotifications((prev) => {
      const next = prev.map((n) => (n.id === id ? { ...n, read: true } : n));
      saveNotifications(next);
      return next;
    });
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => {
      const next = prev.map((n) => ({ ...n, read: true }));
      saveNotifications(next);
      return next;
    });
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => {
      const next = prev.filter((n) => n.id !== id);
      saveNotifications(next);
      return next;
    });
  }, []);

  return {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    dismiss,
    addLocalNotification,
  };
}
