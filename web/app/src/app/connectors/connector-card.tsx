'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { Connector } from '@/lib/supabase/types';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? '';

const providerLabels: Record<string, string> = {
  gmail: 'Gmail',
  google_calendar: 'Google Calendar',
  google_photos: 'Google Photos',
  whoop: 'Whoop',
  apple_health: 'Apple Health',
};

const providerIcons: Record<string, string> = {
  gmail: '✉',
  google_calendar: '📅',
  google_photos: '📷',
  whoop: '💪',
  apple_health: '❤',
};

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

  return (
    <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-800 text-xs font-bold">
          {providerIcons[connector.provider] ?? '🔗'}
        </div>
        <div>
          <p className="text-sm font-medium">{connector.label}</p>
          <p className="text-xs text-zinc-500">{providerLabels[connector.provider] ?? connector.provider}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-xs ${
            connector.status === 'active'
              ? 'bg-emerald-900/50 text-emerald-400'
              : connector.status === 'error'
                ? 'bg-red-900/50 text-red-400'
                : 'bg-zinc-800 text-zinc-500'
          }`}
        >
          {connector.status}
        </span>
        <button
          onClick={handleDisconnect}
          disabled={deleting}
          className="text-xs text-zinc-500 hover:text-red-400 disabled:opacity-50"
        >
          {deleting ? '...' : 'Disconnect'}
        </button>
      </div>
    </div>
  );
}
