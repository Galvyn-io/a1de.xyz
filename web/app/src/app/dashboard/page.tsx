import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@galvyn-io/design/components';
import { createClient } from '@/lib/supabase/server';
import type { UserProfile } from '@/lib/supabase/types';
import { AppShell } from '@/components/app-shell';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', user!.id)
    .single<UserProfile>();

  const assistantName = profile?.assistant_name ?? 'A1DE';

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-2xl px-4 sm:px-6 pt-12 pb-16">
        <div className="mb-8">
          <h1 className="font-serif text-4xl font-medium tracking-tight">
            Meet <span className="italic">{assistantName}</span>
          </h1>
          <p className="mt-2 text-sm text-fg-muted">
            Your personal family AI assistant — calendar, email, health, and golf, all remembered.
          </p>
        </div>

        <div className="mb-6 rounded-xl border border-border bg-surface px-4 py-3">
          <p className="text-xs uppercase tracking-wider text-fg-subtle">Signed in as</p>
          <p className="mt-1 text-sm font-medium">{user?.email}</p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Link href="/chat" className="sm:col-span-2">
            <Button variant="accent" size="lg" className="w-full">
              Chat with {assistantName}
            </Button>
          </Link>
          <Link href="/insights">
            <Button variant="default" size="md" className="w-full">Insights</Button>
          </Link>
          <Link href="/memories">
            <Button variant="default" size="md" className="w-full">Memory</Button>
          </Link>
          <Link href="/tasks">
            <Button variant="default" size="md" className="w-full">Tasks</Button>
          </Link>
          <Link href="/connectors">
            <Button variant="default" size="md" className="w-full">Connectors</Button>
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
