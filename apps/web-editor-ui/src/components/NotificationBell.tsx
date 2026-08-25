import { useEffect, useRef, useState } from 'react';
import { Bell, Check, CheckCheck, Clock, Users, X } from 'lucide-react';
import type { AppNotification } from '@frelated/types';
import { useNotifications } from '../hooks/useNotifications';

interface NotificationBellProps {
  /** 'light' for dark backgrounds (Dashboard), 'dark' for light backgrounds (ProjectsPage) */
  theme?: 'light' | 'dark';
  onApprove?: (projectId: string, collaboratorId: string) => Promise<void>;
  onReject?: (projectId: string, collaboratorId: string) => Promise<void>;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 2) return "À l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  if (hours < 24) return `il y a ${hours}h`;
  if (days < 7) return `il y a ${days}j`;
  return new Date(dateStr).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
  });
}

const NotificationBell: React.FC<NotificationBellProps> = ({
  theme = 'dark',
  onApprove,
  onReject,
}) => {
  const [open, setOpen] = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const { notifications, unreadCount, markAllAsRead, dismiss } =
    useNotifications();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleApprove = async (n: AppNotification) => {
    setActioning(n.id + '_approve');
    try {
      await onApprove?.(n.projectId, n.collaboratorId);
      dismiss(n.id);
    } finally {
      setActioning(null);
    }
  };

  const handleReject = async (n: AppNotification) => {
    setActioning(n.id + '_reject');
    try {
      await onReject?.(n.projectId, n.collaboratorId);
      dismiss(n.id);
    } finally {
      setActioning(null);
    }
  };

  // Style helpers based on theme
  const btnCls =
    theme === 'light'
      ? 'relative p-1.5 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors'
      : 'relative p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors';

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        className={btnCls}
        aria-label="Notifications"
        title="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl shadow-2xl shadow-black/15 border border-slate-100 z-[200] overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-slate-600" />
              <span className="text-[13px] font-semibold text-slate-800">
                Notifications
              </span>
              {unreadCount > 0 && (
                <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {unreadCount}
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="flex items-center gap-1 text-[11px] text-emerald-600 hover:text-emerald-700 font-medium"
                title="Tout marquer comme lu"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Tout lire
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[400px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mb-3">
                  <Bell className="w-5 h-5 text-slate-300" />
                </div>
                <p className="text-[13px] font-medium text-slate-500">
                  Aucune notification
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Vous êtes à jour !
                </p>
              </div>
            ) : (
              notifications.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  actioning={actioning}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  onDismiss={dismiss}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface NotificationItemProps {
  notification: AppNotification;
  actioning: string | null;
  onApprove: (n: AppNotification) => Promise<void>;
  onReject: (n: AppNotification) => Promise<void>;
  onDismiss: (id: string) => void;
}

const NotificationItem: React.FC<NotificationItemProps> = ({
  notification: n,
  actioning,
  onApprove,
  onReject,
  onDismiss,
}) => {
  const isApprovingThis = actioning === n.id + '_approve';
  const isRejectingThis = actioning === n.id + '_reject';
  const isActioning = isApprovingThis || isRejectingThis;

  return (
    <div
      className={`px-4 py-3 border-b border-slate-50 last:border-0 ${
        n.read ? 'bg-white' : 'bg-blue-50/40'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-amber-100 border border-amber-200 flex items-center justify-center mt-0.5">
          <Users className="w-3.5 h-3.5 text-amber-600" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-[12.5px] text-slate-800 leading-relaxed">
            <span className="font-semibold">{n.requesterName}</span>
            {' demande à rejoindre '}
            <span className="font-semibold text-emerald-700">
              {n.projectName}
            </span>
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            {timeAgo(n.createdAt)}
          </p>

          {/* Action buttons */}
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={() => void onApprove(n)}
              disabled={isActioning}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isApprovingThis ? (
                <span className="w-3 h-3 border-2 border-white/50 border-t-white rounded-full animate-spin" />
              ) : (
                <Check className="w-3 h-3" />
              )}
              Approuver
            </button>
            <button
              onClick={() => void onReject(n)}
              disabled={isActioning}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors border border-red-200"
            >
              {isRejectingThis ? (
                <span className="w-3 h-3 border-2 border-red-300 border-t-red-500 rounded-full animate-spin" />
              ) : (
                <X className="w-3 h-3" />
              )}
              Refuser
            </button>
          </div>
        </div>

        {/* Dismiss */}
        <button
          onClick={() => onDismiss(n.id)}
          className="flex-shrink-0 p-0.5 rounded text-slate-300 hover:text-slate-500 hover:bg-slate-100 transition-colors"
          title="Ignorer"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Unread dot */}
      {!n.read && (
        <div className="absolute left-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-blue-500 rounded-full" />
      )}
    </div>
  );
};

export default NotificationBell;
