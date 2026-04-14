'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@galvyn-io/design/components';
import { createClient } from '@/lib/supabase/client';

export default function RegisterPage() {
  const [assistantName, setAssistantName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assistantName.trim()) return;

    setLoading(true);
    setError('');

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/login');
      return;
    }

    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({ assistant_name: assistantName.trim(), is_registered: true })
      .eq('id', user.id);

    if (updateError) {
      console.error('Registration error:', updateError);
      setError(updateError.message);
      setLoading(false);
      return;
    }

    router.push('/dashboard');
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">Welcome to A1DE</h1>
          <p className="mt-2 text-fg-muted">Let&apos;s set up your assistant</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <Input
            label="What would you like to name your assistant?"
            value={assistantName}
            onChange={(e) => setAssistantName(e.target.value)}
            placeholder="e.g. Jarvis, Friday, A1DE"
            error={error || undefined}
            autoFocus
          />

          <Button
            type="submit"
            variant="accent"
            size="lg"
            loading={loading}
            disabled={!assistantName.trim()}
            className="w-full"
          >
            Continue
          </Button>
        </form>
      </div>
    </div>
  );
}
