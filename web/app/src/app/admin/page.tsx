import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@galvyn-io/design/components';
import { createClient } from '@/lib/supabase/server';
import type { UserProfile } from '@/lib/supabase/types';

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
    <div className="mx-auto max-w-4xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
          <p className="mt-1 text-fg-muted">Registered users</p>
        </div>
        <Link href="/dashboard" className="text-sm text-fg-muted hover:text-fg">
          ← Back to dashboard
        </Link>
      </div>

      {error ? (
        <p className="text-error">Failed to load users: {error.message}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-surface">
              <tr>
                <th className="px-4 py-3 font-medium text-fg-muted">Email</th>
                <th className="px-4 py-3 font-medium text-fg-muted">Assistant Name</th>
                <th className="px-4 py-3 font-medium text-fg-muted">Registered</th>
                <th className="px-4 py-3 font-medium text-fg-muted">Signed Up</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users?.map((u) => (
                <tr key={u.id} className="hover:bg-surface/50">
                  <td className="px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3">{u.assistant_name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <Badge variant={u.is_registered ? 'success' : 'default'} size="sm">
                      {u.is_registered ? 'Yes' : 'No'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-fg-muted">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {(!users || users.length === 0) && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-fg-subtle">
                    No users yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
