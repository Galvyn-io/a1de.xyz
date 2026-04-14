import Link from 'next/link';
import { Button, Card } from '@galvyn-io/design/components';
import { createClient } from '@/lib/supabase/server';
import type { UserProfile } from '@/lib/supabase/types';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', user!.id)
    .single<UserProfile>();

  const assistantName = profile?.assistant_name ?? 'A1DE';

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Meet {assistantName}
          </h1>
          <p className="mt-2 text-fg-muted">Your personal AI assistant.</p>
        </div>

        <Card border="subtle" padding="md" className="text-left">
          <p className="text-xs uppercase tracking-wider text-fg-subtle">Signed in as</p>
          <p className="mt-1 font-medium">{user?.email}</p>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Link href="/chat" className="col-span-2">
            <Button variant="accent" size="lg" className="w-full">
              Chat with {assistantName}
            </Button>
          </Link>
          <Link href="/memories">
            <Button variant="default" size="md" className="w-full">Memory</Button>
          </Link>
          <Link href="/tasks">
            <Button variant="default" size="md" className="w-full">Tasks</Button>
          </Link>
          <Link href="/connectors" className="col-span-2">
            <Button variant="ghost" size="md" className="w-full">Manage Connectors</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
