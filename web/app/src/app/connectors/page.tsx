import Link from 'next/link';
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
          <p className="mt-1 text-zinc-400">Connect your data sources</p>
        </div>
        <Link
          href="/connectors/add"
          className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-zinc-200"
        >
          Add connector
        </Link>
      </div>

      {params.success && (
        <div className="mb-6 rounded-xl border border-emerald-800 bg-emerald-950/50 px-4 py-3 text-sm text-emerald-400">
          Connector added successfully.
        </div>
      )}

      {params.error && (
        <div className="mb-6 rounded-xl border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-400">
          Failed to connect: {params.error}
        </div>
      )}

      {(!connectors || connectors.length === 0) && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-12 text-center">
          <p className="text-zinc-400">No connectors yet.</p>
          <Link href="/connectors/add" className="mt-2 inline-block text-sm text-white underline">
            Add your first connector
          </Link>
        </div>
      )}

      {sections.map(([type, items]) => (
        <section key={type} className="mb-8">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-zinc-500">{type}</h2>
          <div className="space-y-3">
            {items.map((c) => (
              <ConnectorCard key={c.id} connector={c} />
            ))}
          </div>
        </section>
      ))}

      <div className="mt-8">
        <Link href="/dashboard" className="text-sm text-zinc-400 hover:text-zinc-200">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
