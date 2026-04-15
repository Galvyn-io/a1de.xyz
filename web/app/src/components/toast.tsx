'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

type ToastVariant = 'default' | 'success' | 'error';

interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Lightweight toast notifications. Call `useToast().toast("message")` from any component.
 * Toasts auto-dismiss after 4 seconds.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, variant: ToastVariant = 'default') => {
    const id = Math.random().toString(36).slice(2, 10);
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    // Trigger enter animation on mount
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const borderColor =
    toast.variant === 'success'
      ? 'border-l-success'
      : toast.variant === 'error'
        ? 'border-l-error'
        : 'border-l-accent';

  return (
    <div
      role="status"
      className={`pointer-events-auto flex min-w-[260px] max-w-md items-start gap-2 rounded-lg border border-border border-l-2 ${borderColor} bg-surface px-3 py-2.5 text-sm text-fg shadow-lg transition-all ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'
      }`}
    >
      <span className="flex-1">{toast.message}</span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="text-fg-subtle hover:text-fg"
      >
        ✕
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback: no-op when provider isn't mounted (e.g. server-side)
    return { toast: () => { /* noop */ } };
  }
  return ctx;
}
