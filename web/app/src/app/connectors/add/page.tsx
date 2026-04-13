'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? '';

const CONNECTOR_OPTIONS = [
  { type: 'email', provider: 'gmail', label: 'Gmail', description: 'Read your email', icon: '✉' },
  { type: 'calendar', provider: 'google_calendar', label: 'Google Calendar', description: 'Access your calendar', icon: '📅' },
  { type: 'photos', provider: 'google_photos', label: 'Google Photos', description: 'Access your photos', icon: '📷' },
] as const;

export default function AddConnectorPage() {
  const [step, setStep] = useState<'pick' | 'label'>('pick');
  const [selected, setSelected] = useState<(typeof CONNECTOR_OPTIONS)[number] | null>(null);
  const [connectorLabel, setConnectorLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSelect = (option: (typeof CONNECTOR_OPTIONS)[number]) => {
    setSelected(option);
    setStep('label');
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;

    setLoading(true);
    setError('');

    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        setError('Not authenticated');
        setLoading(false);
        return;
      }

      const res = await fetch(`${BACKEND_URL}/connectors/google/auth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          type: selected.type,
          provider: selected.provider,
          label: connectorLabel.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.url) {
        setError(data.error ?? 'Failed to start authorization');
        setLoading(false);
        return;
      }

      window.location.href = data.url;
    } catch {
      setError('Something went wrong');
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg px-6 py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Add Connector</h1>
        <p className="mt-1 text-zinc-400">Connect a data source to your assistant</p>
      </div>

      {step === 'pick' && (
        <div className="space-y-3">
          {CONNECTOR_OPTIONS.map((option) => (
            <button
              key={option.provider}
              onClick={() => handleSelect(option)}
              className="flex w-full items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-4 text-left transition-colors hover:border-zinc-600"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-800 text-lg">
                {option.icon}
              </div>
              <div>
                <p className="text-sm font-medium">{option.label}</p>
                <p className="text-xs text-zinc-500">{option.description}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {step === 'label' && selected && (
        <form onSubmit={handleConnect} className="space-y-6">
          <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
            <span className="text-lg">{selected.icon}</span>
            <span className="text-sm font-medium">{selected.label}</span>
          </div>

          <div>
            <label htmlFor="label" className="block text-sm font-medium text-zinc-300">
              Give it a name (optional)
            </label>
            <input
              id="label"
              type="text"
              value={connectorLabel}
              onChange={(e) => setConnectorLabel(e.target.value)}
              placeholder="e.g. Personal, Work, Side Hustle"
              className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm placeholder-zinc-600 outline-none transition-colors focus:border-zinc-600"
              autoFocus
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => { setStep('pick'); setSelected(null); setConnectorLabel(''); }}
              className="rounded-xl border border-zinc-800 px-4 py-3 text-sm font-medium transition-colors hover:bg-zinc-900"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded-xl bg-white px-4 py-3 text-sm font-medium text-zinc-950 transition-colors hover:bg-zinc-200 disabled:opacity-50"
            >
              {loading ? 'Connecting...' : 'Connect with Google'}
            </button>
          </div>
        </form>
      )}

      <div className="mt-8">
        <Link href="/connectors" className="text-sm text-zinc-400 hover:text-zinc-200">
          Back to connectors
        </Link>
      </div>
    </div>
  );
}
