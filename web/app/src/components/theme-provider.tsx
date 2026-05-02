'use client';

/**
 * Theme system: light + dark + system.
 *
 * Galvyn's CSS already defines tokens for both themes — we just toggle
 * the `data-theme` attribute on <html>. The tricky bit is avoiding a
 * flash of wrong theme (FOUC) on first paint, so the actual attribute
 * is set by an inline script in <head> (see ThemeScript) BEFORE any
 * React renders. This provider is just for runtime toggling.
 */
import { createContext, useContext, useEffect, useState, useCallback } from 'react';

type ThemeChoice = 'light' | 'dark' | 'system';
type Resolved = 'light' | 'dark';

interface ThemeCtx {
  /** What the user picked (incl. 'system'). */
  choice: ThemeChoice;
  /** What's actually applied (system resolved to light/dark). */
  resolved: Resolved;
  setTheme: (next: ThemeChoice) => void;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

const STORAGE_KEY = 'a1de-theme';

function resolve(choice: ThemeChoice): Resolved {
  if (choice === 'system') {
    if (typeof window === 'undefined') return 'dark';
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return choice;
}

function apply(resolved: Resolved): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolved);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [choice, setChoice] = useState<ThemeChoice>('system');
  const [resolved, setResolved] = useState<Resolved>('dark');

  // Sync from localStorage + system on mount.
  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as ThemeChoice | null) ?? 'system';
    setChoice(stored);
    const r = resolve(stored);
    setResolved(r);
    apply(r);

    // Watch system preference if user is on 'system'.
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      const c = (localStorage.getItem(STORAGE_KEY) as ThemeChoice | null) ?? 'system';
      if (c === 'system') {
        const next = mq.matches ? 'light' : 'dark';
        setResolved(next);
        apply(next);
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setTheme = useCallback((next: ThemeChoice) => {
    setChoice(next);
    localStorage.setItem(STORAGE_KEY, next);
    const r = resolve(next);
    setResolved(r);
    apply(r);
  }, []);

  const toggle = useCallback(() => {
    // Light → dark → system → light. Three-way toggle keeps "follow OS"
    // reachable without a separate menu.
    const next: ThemeChoice =
      choice === 'light' ? 'dark' : choice === 'dark' ? 'system' : 'light';
    setTheme(next);
  }, [choice, setTheme]);

  return (
    <Ctx.Provider value={{ choice, resolved, setTheme, toggle }}>{children}</Ctx.Provider>
  );
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

/**
 * Renders an inline script in <head> that sets `data-theme` BEFORE React
 * hydrates. Without this, every page flashes the wrong theme on load.
 *
 * The script is small enough to inline; using dangerouslySetInnerHTML so
 * Next emits it as text (no module overhead, no defer).
 */
export function ThemeScript() {
  const code = `(function(){try{var k='${STORAGE_KEY}';var c=localStorage.getItem(k)||'system';var r=c==='system'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):c;document.documentElement.setAttribute('data-theme',r);}catch(_){document.documentElement.setAttribute('data-theme','dark');}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
