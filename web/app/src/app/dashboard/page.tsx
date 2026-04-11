import Link from 'next/link';
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

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-6 px-4 text-center">
        <h1 className="text-3xl font-bold tracking-tight">
          Meet {profile?.assistant_name}
        </h1>
        <p className="text-zinc-400">
          Your personal AI assistant is ready. More features coming soon.
        </p>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <p className="text-sm text-zinc-500">Signed in as</p>
          <p className="mt-1 font-medium">{user?.email}</p>
        </div>
        <Link
          href="/connectors"
          className="inline-block rounded-xl border border-zinc-800 px-6 py-3 text-sm font-medium transition-colors hover:bg-zinc-900"
        >
          Manage Connectors
        </Link>
      </div>
    </div>
  );
}
