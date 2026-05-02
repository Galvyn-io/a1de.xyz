import type { Metadata } from 'next';
import Link from 'next/link';
import { Button, Card } from '@galvyn-io/design/components';
import { createClient } from '@/lib/supabase/server';
import type { Connector } from '@/lib/supabase/types';
import { ConnectorCard } from './connector-card';
import { AppShell } from '@/components/app-shell';

export const metadata: Metadata = { title: 'Connectors' };

export default async function ConnectorsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: connectors } = await supabase
    .from('connectors')
    .select('*')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })
    .returns<Connector[]>();

  const sections = Object.entries(
    (connectors ?? []).reduce<Record<string, Connector[]>>((acc, c) => {
      (acc[c.type] ??= []).push(c);
      return acc;
    }, {}),
  );

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-2xl px-4 sm:px-6 pt-8 pb-16">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-serif text-3xl font-medium tracking-tight">Connectors</h1>
            <p className="mt-1 text-sm text-fg-muted">Connect your data sources</p>
          </div>
          <Link href="/connectors/add">
            <Button variant="accent" size="md">+ Add connector</Button>
          </Link>
        </div>

      {params.success && (
        <Card border="subtle" padding="md" className="mb-6 border-l-2 border-l-success bg-success/10">
          <p className="text-sm text-success">Connector added successfully.</p>
        </Card>
      )}

      {params.error && (
        <Card border="subtle" padding="md" className="mb-6 border-l-2 border-l-error bg-error/10">
          <p className="text-sm text-error">Failed to connect: {params.error}</p>
        </Card>
      )}

      {(!connectors || connectors.length === 0) && (
        <div className="rounded-xl border border-border bg-surface p-12 text-center fade-in">
          <div className="mb-3 text-4xl">🔌</div>
          <p className="font-serif text-xl">Nothing connected yet</p>
          <p className="mt-2 text-sm text-fg-muted">
            Connect a calendar, email, bank, or wearable and your assistant
            will start learning what matters to you.
          </p>
          <Link
            href="/connectors/add"
            className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold accent-on-bg transition-opacity hover:opacity-90"
          >
            Add your first connector →
          </Link>
        </div>
      )}

      {sections.map(([type, items]) => (
        <section key={type} className="mb-8 fade-in">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-fg-subtle">{type}</h2>
          <div className="space-y-2">
            {items.map((c) => (
              <ConnectorCard key={c.id} connector={c} />
            ))}
          </div>
        </section>
      ))}
      </div>
    </AppShell>
  );
}
