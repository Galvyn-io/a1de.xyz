import Link from 'next/link';
import { Button, Card } from '@galvyn-io/design/components';
import { createClient } from '@/lib/supabase/server';
import type { Connector } from '@/lib/supabase/types';
import { ConnectorCard } from './connector-card';

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
    <div className="mx-auto max-w-2xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Connectors</h1>
          <p className="mt-1 text-fg-muted">Connect your data sources</p>
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
        <Card border="subtle" padding="lg" className="text-center">
          <p className="text-fg-muted">No connectors yet.</p>
          <Link href="/connectors/add" className="mt-2 inline-block text-sm text-accent-text hover:underline">
            Add your first connector
          </Link>
        </Card>
      )}

      {sections.map(([type, items]) => (
        <section key={type} className="mb-8">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-fg-subtle">{type}</h2>
          <div className="space-y-2">
            {items.map((c) => (
              <ConnectorCard key={c.id} connector={c} />
            ))}
          </div>
        </section>
      ))}

      <div className="mt-8">
        <Link href="/dashboard" className="text-sm text-fg-muted hover:text-fg">
          ← Back to dashboard
        </Link>
      </div>
    </div>
  );
}
