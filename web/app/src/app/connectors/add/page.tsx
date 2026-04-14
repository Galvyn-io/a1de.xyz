'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePlaidLink } from 'react-plaid-link';
import { Button, Input } from '@galvyn-io/design/components';
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
      <Button onClick={startPlaid} loading={loading} variant="accent" size="md" className="flex-1">
        Connect Bank
      </Button>
      {error && <p className="text-sm text-error">{error}</p>}
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
        <p className="mt-1 text-fg-muted">Connect a data source to your assistant</p>
      </div>

      {step === 'pick' && (
        <div className="space-y-2">
          {CONNECTOR_OPTIONS.map((option) => (
            <button
              key={option.provider}
              onClick={() => handleSelect(option)}
              className="flex w-full items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-border-strong"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-surface-2 text-base">
                {PROVIDER_META[option.provider].icon}
              </div>
              <div>
                <p className="text-sm font-medium">{PROVIDER_META[option.provider].label}</p>
                <p className="text-xs text-fg-subtle">{option.description}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {step === 'label' && selected && (
        <form onSubmit={selected.authFlow === 'google' ? handleGoogleConnect : (e) => e.preventDefault()} className="space-y-6">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">
            <span className="text-lg">{PROVIDER_META[selected.provider].icon}</span>
            <span className="text-sm font-medium">{PROVIDER_META[selected.provider].label}</span>
          </div>

          <Input
            label="Give it a name (optional)"
            value={connectorLabel}
            onChange={(e) => setConnectorLabel(e.target.value)}
            placeholder={selected.authFlow === 'plaid' ? 'e.g. Chase, Amex, Savings' : 'e.g. Personal, Work, Side Hustle'}
            error={error || undefined}
            autoFocus
          />

          <div className="flex gap-3">
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => { setStep('pick'); setSelected(null); setConnectorLabel(''); setError(''); }}
            >
              Back
            </Button>

            {selected.authFlow === 'plaid' ? (
              <PlaidLinkButton
                label={connectorLabel.trim() || 'Bank Account'}
                onDone={() => router.push('/connectors?success=true')}
              />
            ) : (
              <Button type="submit" loading={loading} variant="accent" size="md" className="flex-1">
                Connect with Google
              </Button>
            )}
          </div>
        </form>
      )}

      <div className="mt-8">
        <Link href="/connectors" className="text-sm text-fg-muted hover:text-fg">
          ← Back to connectors
        </Link>
      </div>
    </div>
  );
}
