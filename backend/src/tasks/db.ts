import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import type { TaskRow, TaskStatus } from './types.js';

function getServiceClient() {
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
}

export async function insertTask(params: {
  userId: string;
  type: string;
  input?: Record<string, unknown>;
  conversationId?: string;
  scheduleId?: string;
  parentTaskId?: string;
  scheduledFor?: Date;
}): Promise<TaskRow> {
  const db = getServiceClient();
  const { data, error } = await db
    .from('tasks')
    .insert({
      user_id: params.userId,
      type: params.type,
      input: params.input ?? {},
      conversation_id: params.conversationId ?? null,
      schedule_id: params.scheduleId ?? null,
      parent_task_id: params.parentTaskId ?? null,
      scheduled_for: params.scheduledFor?.toISOString() ?? null,
      status: 'pending',
    })
    .select()
    .single<TaskRow>();
  if (error) throw error;
  return data!;
}

export async function getTask(id: string): Promise<TaskRow | null> {
  const db = getServiceClient();
  const { data, error } = await db
    .from('tasks')
    .select('*')
    .eq('id', id)
    .maybeSingle<TaskRow>();
  if (error) throw error;
  return data ?? null;
}

export async function getTaskForUser(id: string, userId: string): Promise<TaskRow | null> {
  const db = getServiceClient();
  const { data, error } = await db
    .from('tasks')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle<TaskRow>();
  if (error) throw error;
  return data ?? null;
}

export async function listTasks(userId: string, options?: {
  statuses?: TaskStatus[];
  limit?: number;
}): Promise<TaskRow[]> {
  const db = getServiceClient();
  let q = db
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (options?.statuses) {
    q = q.in('status', options.statuses);
  }
  if (options?.limit) {
    q = q.limit(options.limit);
  }

  const { data, error } = await q.returns<TaskRow[]>();
  if (error) throw error;
  return data ?? [];
}

export async function listRunningTasks(olderThanSeconds = 30): Promise<TaskRow[]> {
  // Find tasks stuck in 'running' that haven't been updated recently — these need polling
  const cutoff = new Date(Date.now() - olderThanSeconds * 1000).toISOString();
  const db = getServiceClient();
  const { data, error } = await db
    .from('tasks')
    .select('*')
    .eq('status', 'running')
    .lt('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(100)
    .returns<TaskRow[]>();
  if (error) throw error;
  return data ?? [];
}

export async function updateTask(id: string, updates: Partial<{
  status: TaskStatus;
  output: Record<string, unknown> | null;
  error: string | null;
  external_provider: string | null;
  external_id: string | null;
  progress_message: string | null;
  progress_pct: number | null;
  started_at: string | null;
  completed_at: string | null;
  retry_count: number;
}>): Promise<TaskRow> {
  const db = getServiceClient();
  const { data, error } = await db
    .from('tasks')
    .update(updates)
    .eq('id', id)
    .select()
    .single<TaskRow>();
  if (error) throw error;
  return data!;
}

export async function getTaskByExternalId(provider: string, externalId: string): Promise<TaskRow | null> {
  const db = getServiceClient();
  const { data, error } = await db
    .from('tasks')
    .select('*')
    .eq('external_provider', provider)
    .eq('external_id', externalId)
    .maybeSingle<TaskRow>();
  if (error) throw error;
  return data ?? null;
}
