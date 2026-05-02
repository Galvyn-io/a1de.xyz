'use client';

import { useTheme } from './theme-provider';

/**
 * Three-way theme toggle: light / dark / system.
 *
 * One click cycles. Icon reflects the *current* resolved theme + a tiny
 * dot when on 'system' to signal "auto."
 */
export function ThemeToggle() {
  const { choice, resolved, toggle } = useTheme();

  const label =
    choice === 'system'
      ? `Theme: follows system (${resolved})`
      : `Theme: ${choice}`;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="relative flex h-8 w-8 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface hover:text-fg focus:outline focus:outline-1 focus:outline-accent"
    >
      {resolved === 'dark' ? (
        // Moon
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M11.5 9.5A4 4 0 016.5 4.5a4 4 0 00.96 7.04 4 4 0 004.04-2.04z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        // Sun
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.3" />
          <path
            d="M8 1.5v1.5M8 13v1.5M14.5 8H13M3 8H1.5M12.6 3.4l-1.06 1.06M4.46 11.54L3.4 12.6M12.6 12.6l-1.06-1.06M4.46 4.46L3.4 3.4"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      )}
      {choice === 'system' && (
        <span
          className="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-accent"
          aria-hidden
        />
      )}
    </button>
  );
}
