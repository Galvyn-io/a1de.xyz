'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePlaidLink } from 'react-plaid-link';
import { createClient } from '@/lib/supabase/client';
import { CONNECTOR_OPTIONS, PROVIDER_META } from '@/lib/connectors';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? '';

function PlaidLinkButton({ label, onDone }: { label: string; onDone: () => void }) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const startPlaid = async () => {
    setLoading(true);
    setError('');
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setError('Not authenticated'); setLoading(false); return; }

    const res = await fetch(`${BACKEND_URL}/connectors/plaid/link-token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const data = await res.json();
    if (data.link_token) {
      setLinkToken(data.link_token);
    } else {
      setError('Failed to initialize Plaid');
      setLoading(false);
    }
  };

  const onSuccess = useCallback(async (publicToken: string) => {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    await fetch(`${BACKEND_URL}/connectors/plaid/exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ public_token: publicToken, label }),
    });
    onDone();
  }, [label, onDone]);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: () => { setLoading(false); setLinkToken(null); },
  });

  // Auto-open when link token is ready
  if (linkToken && ready) {
    setTimeout(() => open(), 0);
  }

  return (
    <>
      <button
        onClick={startPlaid}
        disabled={loading}
        className="flex-1 rounded-xl bg-white px-4 py-3 text-sm font-medium text-zinc-950 transition-colors hover:bg-zinc-200 disabled:opacity-50"
      >
        {loading ? 'Connecting...' : 'Connect Bank'}
      </button>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </>
  );
}

export default function AddConnectorPage() {
  const router = useRouter();
  const [step, setStep] = useState<'pick' | 'label'>('pick');
  const [selected, setSelected] = useState<(typeof CONNECTOR_OPTIONS)[number] | null>(null);
  const [connectorLabel, setConnectorLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSelect = (option: (typeof CONNECTOR_OPTIONS)[number]) => {
    setSelected(option);
    setStep('label');
  };

  const handleGoogleConnect = async (e: React.FormEvent) => {
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
                {PROVIDER_META[option.provider].icon}
              </div>
              <div>
                <p className="text-sm font-medium">{PROVIDER_META[option.provider].label}</p>
                <p className="text-xs text-zinc-500">{option.description}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {step === 'label' && selected && (
        <form onSubmit={selected.authFlow === 'google' ? handleGoogleConnect : (e) => e.preventDefault()} className="space-y-6">
          <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
            <span className="text-lg">{PROVIDER_META[selected.provider].icon}</span>
            <span className="text-sm font-medium">{PROVIDER_META[selected.provider].label}</span>
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
              placeholder={selected.authFlow === 'plaid' ? 'e.g. Chase, Amex, Savings' : 'e.g. Personal, Work, Side Hustle'}
              className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm placeholder-zinc-600 outline-none transition-colors focus:border-zinc-600"
              autoFocus
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => { setStep('pick'); setSelected(null); setConnectorLabel(''); setError(''); }}
              className="rounded-xl border border-zinc-800 px-4 py-3 text-sm font-medium transition-colors hover:bg-zinc-900"
            >
              Back
            </button>

            {selected.authFlow === 'plaid' ? (
              <PlaidLinkButton
                label={connectorLabel.trim() || 'Bank Account'}
                onDone={() => router.push('/connectors?success=true')}
              />
            ) : (
              <button
                type="submit"
                disabled={loading}
                className="flex-1 rounded-xl bg-white px-4 py-3 text-sm font-medium text-zinc-950 transition-colors hover:bg-zinc-200 disabled:opacity-50"
              >
                {loading ? 'Connecting...' : 'Connect with Google'}
              </button>
            )}
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
