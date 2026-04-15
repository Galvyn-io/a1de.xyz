'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Button } from '@galvyn-io/design/components';

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

/**
 * Themed confirmation dialog. Replaces browser confirm().
 *
 * Usage:
 *   const { confirm } = useConfirm();
 *   const ok = await confirm({ title: 'Delete?', variant: 'danger' });
 *   if (ok) { ... }
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, resolve });
    });
  }, []);

  const handle = useCallback((ok: boolean) => {
    if (pending) {
      pending.resolve(ok);
      setPending(null);
    }
  }, [pending]);

  // Escape key to cancel; focus confirm button on open
  useEffect(() => {
    if (!pending) return;
    confirmButtonRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handle(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, handle]);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => handle(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
        >
          <div
            className="w-full max-w-sm rounded-xl border border-border-strong bg-surface p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="confirm-title" className="text-base font-semibold">{pending.title}</h3>
            {pending.message && (
              <p className="mt-2 text-sm text-fg-muted">{pending.message}</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => handle(false)}>
                {pending.cancelLabel ?? 'Cancel'}
              </Button>
              <Button
                ref={confirmButtonRef}
                variant={pending.variant === 'danger' ? 'danger' : 'accent'}
                size="sm"
                onClick={() => handle(true)}
              >
                {pending.confirmLabel ?? 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    // Fallback: browser confirm if provider isn't mounted
    return {
      confirm: async (opts) => window.confirm(opts.message ?? opts.title),
    };
  }
  return ctx;
}
