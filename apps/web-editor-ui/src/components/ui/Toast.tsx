import { useCallback, useRef, useState, ReactNode } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { ToastContext, ToastKind } from './ToastContext';

interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

const ICONS: Record<ToastKind, React.FC<{ className?: string }>> = {
  success: ({ className }) => <CheckCircle2 className={className} />,
  error: ({ className }) => <XCircle className={className} />,
  warning: ({ className }) => <AlertTriangle className={className} />,
  info: ({ className }) => <Info className={className} />,
};

const COLORS: Record<ToastKind, string> = {
  success: 'text-emerald-600',
  error: 'text-red-600',
  warning: 'text-amber-600',
  info: 'text-blue-600',
};

export const ToastProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    clearTimeout(timerRef.current[id]);
    delete timerRef.current[id];
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev, { id, kind, message }]);
      timerRef.current[id] = setTimeout(() => dismiss(id), 4200);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Toast container */}
      <div
        className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none"
        aria-live="polite"
      >
        {toasts.map((t) => {
          const Icon = ICONS[t.kind];
          return (
            <div
              key={t.id}
              className="toast-enter pointer-events-auto flex items-start gap-3 min-w-[280px] max-w-sm bg-white rounded-2xl shadow-xl shadow-black/10 border border-slate-100 px-4 py-3"
            >
              <Icon
                className={`w-5 h-5 mt-0.5 flex-shrink-0 ${COLORS[t.kind]}`}
              />
              <p className="flex-1 text-sm text-slate-700 leading-snug">
                {t.message}
              </p>
              <button
                onClick={() => dismiss(t.id)}
                className="text-slate-300 hover:text-slate-500 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};
