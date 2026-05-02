'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@galvyn-io/design/components';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/toast';
import { useConfirm } from '@/components/confirm-dialog';
import type { Connector } from '@/lib/supabase/types';
import { PROVIDER_META } from '@/lib/connectors';
import { formatRelative } from '@/lib/format';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? '';

// Providers that support an on-demand refresh
const REFRESHABLE = new Set(['google_calendar', 'gmail', 'whoop']);

export function ConnectorCard({ connector }: { connector: Connector }) {
  const [deleting, setDeleting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  const { confirm } = useConfirm();

  const handleDisconnect = async () => {
    const ok = await confirm({
      title: `Disconnect "${connector.label}"?`,
      message: 'This removes the connection and any stored credentials. You can reconnect anytime.',
      confirmLabel: 'Disconnect',
      variant: 'danger',
    });
    if (!ok) return;

    setDeleting(true);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${BACKEND_URL}/connectors/${connector.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      toast('Connector disconnected', 'success');
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast(`Failed to disconnect: ${msg}`, 'error');
      setDeleting(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${BACKEND_URL}/connectors/${connector.id}/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Server returned ${res.status}`);
      toast(`Refresh started — check Tasks for progress`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast(`Failed to refresh: ${msg}`, 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const statusVariant: 'success' | 'error' | 'default' =
    connector.status === 'active' ? 'success' :
    connector.status === 'error' ? 'error' :
    'default';

  const canRefresh = REFRESHABLE.has(connector.provider);

  return (
    <div className="group flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3 transition-colors hover:border-border-strong">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-surface-2 text-base">
          {PROVIDER_META[connector.provider]?.icon ?? '🔗'}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{connector.label}</p>
          <p className="text-xs text-fg-subtle">
            {PROVIDER_META[connector.provider]?.label ?? connector.provider}
            {canRefresh && (
              <span className="ml-2">· synced {connector.last_synced_at ? formatRelative(connector.last_synced_at) : 'never'}</span>
            )}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <Badge variant={statusVariant} dot>{connector.status}</Badge>
        {canRefresh && (
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label={`Refresh ${connector.label}`}
            className="text-xs text-fg-subtle opacity-0 transition-opacity hover:text-accent-text focus:outline focus:outline-1 focus:outline-accent focus:opacity-100 group-hover:opacity-100 disabled:opacity-50"
            title="Force a full refresh now"
          >
            {refreshing ? '...' : 'Refresh'}
          </button>
        )}
        <button
          onClick={handleDisconnect}
          disabled={deleting}
          aria-label={`Disconnect ${connector.label}`}
          className="text-xs text-fg-subtle opacity-0 transition-opacity hover:text-error focus:outline focus:outline-1 focus:outline-accent focus:opacity-100 group-hover:opacity-100 disabled:opacity-50"
        >
          {deleting ? '...' : 'Disconnect'}
        </button>
      </div>
    </div>
  );
}

