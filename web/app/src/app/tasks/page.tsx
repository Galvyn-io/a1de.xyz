import { createClient } from '@/lib/supabase/server';
import type { Task } from '@/lib/supabase/types';
import { TasksView } from './tasks-view';

export default async function TasksPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: tasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })
    .limit(100)
    .returns<Task[]>();

  return <TasksView initialTasks={tasks ?? []} userId={user!.id} />;
}
