import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { UserProfile } from '@/lib/supabase/types';

export default async function TasksLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('is_registered')
    .eq('id', user.id)
    .single<Pick<UserProfile, 'is_registered'>>();
  if (!profile?.is_registered) redirect('/register');

  return <>{children}</>;
}
