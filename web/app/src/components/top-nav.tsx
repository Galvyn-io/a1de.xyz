'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from './theme-toggle';

const NAV_ITEMS = [
  { href: '/chat', label: 'Chat' },
  { href: '/insights', label: 'Insights' },
  { href: '/memories', label: 'Memory' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/connectors', label: 'Connectors' },
];

/**
 * Sticky top navigation for the authenticated app.
 *
 * Glassmorphism: the bar uses `backdrop-blur` over a low-opacity surface
 * so content scrolls visibly behind it without losing legibility. This
 * is the only persistent floating surface in the app — everything else
 * (cards, message bubbles) stays solid for readability.
 *
 * The active route is detected from `usePathname()` and underlined with
 * the accent color so users always know where they are.
 */
export function TopNav() {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (href === '/chat') return pathname === '/' || pathname.startsWith('/chat');
    return pathname.startsWith(href);
  }

  return (
    <header
      className="sticky top-0 z-30 border-b border-border/60 bg-bg/70 backdrop-blur-xl"
      // backdrop-blur needs a saturate boost to look right when content
      // behind it is colorful.
      style={{ backdropFilter: 'saturate(140%) blur(16px)', WebkitBackdropFilter: 'saturate(140%) blur(16px)' }}
    >
      <div className="mx-auto flex h-12 max-w-6xl items-center gap-1 px-4">
        <Link
          href="/chat"
          className="flex items-center gap-2 pr-3 text-sm font-semibold tracking-tight"
        >
          <span aria-hidden className="inline-block h-5 w-5 rounded bg-accent" />
          A1DE
        </Link>

        <nav className="flex flex-1 items-center gap-0.5 overflow-x-auto">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`relative shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'text-fg'
                    : 'text-fg-muted hover:bg-surface hover:text-fg'
                }`}
              >
                {item.label}
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent"
                  />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              // Trigger the global ⌘K palette by dispatching the same key.
              window.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
              );
            }}
            className="hidden items-center gap-1.5 rounded-md border border-border/70 bg-surface/40 px-2 py-1 text-[10px] font-medium text-fg-muted transition-colors hover:border-border-strong hover:text-fg sm:flex"
            aria-label="Open command palette"
            title="Quick navigate"
          >
            <span>Quick nav</span>
            <kbd className="rounded border border-border/70 px-1 py-0 font-mono text-[9px]">⌘K</kbd>
          </button>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
