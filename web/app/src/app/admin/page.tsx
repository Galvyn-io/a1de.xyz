import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Badge } from '@galvyn-io/design/components';
import { createClient } from '@/lib/supabase/server';
import type { UserProfile } from '@/lib/supabase/types';
import { AppShell } from '@/components/app-shell';
import { AdminTable } from './admin-table';

export const metadata: Metadata = { title: 'Admin' };

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: currentProfile } = await supabase
    .from('user_profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single<Pick<UserProfile, 'is_admin'>>();

  if (!currentProfile?.is_admin) redirect('/dashboard');

  const { data: users, error } = await supabase
    .from('user_profiles')
    .select('*')
    .order('created_at', { ascending: false })
    .returns<UserProfile[]>();

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 pt-8 pb-16">
        <div className="mb-8">
          <h1 className="font-serif text-3xl font-medium tracking-tight">Admin</h1>
          <p className="mt-1 text-sm text-fg-muted">Registered users</p>
        </div>

        {error ? (
          <p className="text-error">Failed to load users: {error.message}</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-surface">
                <tr>
                  <th className="px-4 py-3 font-medium text-fg-muted">Email</th>
                  <th className="px-4 py-3 font-medium text-fg-muted">Assistant Name</th>
                  <th className="px-4 py-3 font-medium text-fg-muted">Registered</th>
                  <th className="px-4 py-3 font-medium text-fg-muted">Signed Up</th>
                </tr>
              </thead>
              <AdminTable users={users ?? []} />
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
