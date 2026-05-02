import { TopNav } from './top-nav';

/**
 * Wraps every authenticated page (except /chat which has its own layout).
 * Provides the persistent top nav and a responsive content container.
 *
 * Don't use this on auth pages (/login, /register, /auth/callback) —
 * they're standalone full-screen flows.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <TopNav />
      <main className="flex-1">{children}</main>
    </div>
  );
}
