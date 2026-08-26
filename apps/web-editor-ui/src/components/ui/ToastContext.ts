import { createContext, useContext } from 'react';

export type ToastKind = 'success' | 'error' | 'warning' | 'info';

export interface ToastContextValue {
  toast: (message: string, kind?: ToastKind) => void;
}

export const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
});

export const useToast = () => useContext(ToastContext);
