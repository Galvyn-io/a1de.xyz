import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { UserProfile } from '@/lib/supabase/types';

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: currentProfile } = await supabase
    .from('user_profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single<Pick<UserProfile, 'is_admin'>>();

  if (!currentProfile?.is_admin) {
    redirect('/dashboard');
  }

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
          <p className="mt-1 text-zinc-400">Registered users</p>
        </div>
        <a href="/dashboard" className="text-sm text-zinc-400 hover:text-zinc-200">
          Back to dashboard
        </a>
      </div>

      {error ? (
        <p className="text-red-400">Failed to load users: {error.message}</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-900">
              <tr>
                <th className="px-4 py-3 font-medium text-zinc-400">Email</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Assistant Name</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Registered</th>
                <th className="px-4 py-3 font-medium text-zinc-400">Signed Up</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {users?.map((u) => (
                <tr key={u.id} className="hover:bg-zinc-900/50">
                  <td className="px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3">{u.assistant_name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs ${
                        u.is_registered
                          ? 'bg-emerald-900/50 text-emerald-400'
                          : 'bg-zinc-800 text-zinc-500'
                      }`}
                    >
                      {u.is_registered ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {(!users || users.length === 0) && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">
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
