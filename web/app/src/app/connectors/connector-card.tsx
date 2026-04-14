'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@galvyn-io/design/components';
import { createClient } from '@/lib/supabase/client';
import type { Connector } from '@/lib/supabase/types';
import { PROVIDER_META } from '@/lib/connectors';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? '';

export function ConnectorCard({ connector }: { connector: Connector }) {
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  const handleDisconnect = async () => {
    if (!confirm(`Disconnect "${connector.label}"?`)) return;
    setDeleting(true);

    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();

    await fetch(`${BACKEND_URL}/connectors/${connector.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });

    router.refresh();
  };

  const statusVariant: 'success' | 'error' | 'default' =
    connector.status === 'active' ? 'success' :
    connector.status === 'error' ? 'error' :
    'default';

  return (
    <div className="group flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3 transition-colors hover:border-border-strong">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-surface-2 text-base">
          {PROVIDER_META[connector.provider]?.icon ?? '🔗'}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{connector.label}</p>
          <p className="text-xs text-fg-subtle">{PROVIDER_META[connector.provider]?.label ?? connector.provider}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <Badge variant={statusVariant} dot>{connector.status}</Badge>
        <button
          onClick={handleDisconnect}
          disabled={deleting}
          className="text-xs text-fg-subtle opacity-0 transition-opacity hover:text-error group-hover:opacity-100 disabled:opacity-50"
        >
          {deleting ? '...' : 'Disconnect'}
        </button>
      </div>
    </div>
  );
}
