'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Badge } from '@galvyn-io/design/components';
import { createClient } from '@/lib/supabase/client';
import type { Task, TaskStatus } from '@/lib/supabase/types';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? '';

interface RecentMemory {
  id: string;
  content: string;
  category: string | null;
  always_inject: boolean;
  created_at: string;
}

const TASK_TYPE_LABELS: Record<string, string> = {
  'golf.search': 'Tee time check',
  'golf.book': 'Booking',
  'memory.extract': 'Memory extraction',
  'email.sync': 'Email sync',
  'calendar.sync': 'Calendar sync',
};

const STATUS_VARIANT: Record<TaskStatus, 'default' | 'accent' | 'success' | 'warning' | 'error'> = {
  pending: 'default',
  running: 'warning',
  completed: 'success',
  failed: 'error',
  cancelled: 'default',
};

function summarizeTask(t: Task): string {
  const input = t.input as Record<string, unknown>;
  if (t.type.startsWith('golf.')) {
    const { course_name, date, time } = input as { course_name?: string; date?: string; time?: string };
    return [course_name, date, time].filter(Boolean).join(' · ');
  }
  return TASK_TYPE_LABELS[t.type] ?? t.type;
}

function ageAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

export function NowPanel({ userId }: { userId: string }) {
  const [activeTasks, setActiveTasks] = useState<Task[]>([]);
  const [recentMemories, setRecentMemories] = useState<RecentMemory[]>([]);
  const [loading, setLoading] = useState(true);

  // Initial load
  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;

      const [tasksRes, memRes] = await Promise.all([
        fetch(`${BACKEND_URL}/tasks?status=pending,running&limit=10`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${BACKEND_URL}/memories`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (tasksRes.ok) {
        const data = await tasksRes.json();
        setActiveTasks(data.tasks);
      }
      if (memRes.ok) {
        const data = await memRes.json();
        setRecentMemories((data.memories as RecentMemory[]).slice(0, 5));
      }
      setLoading(false);
    }
    load();
  }, []);

  // Realtime: tasks
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`now-tasks:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${userId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newTask = payload.new as Task;
            if (newTask.status === 'pending' || newTask.status === 'running') {
              setActiveTasks((prev) => [newTask, ...prev]);
            }
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as Task;
            setActiveTasks((prev) => {
              const existing = prev.find((t) => t.id === updated.id);
              if (existing) {
                if (updated.status === 'pending' || updated.status === 'running') {
                  return prev.map((t) => (t.id === updated.id ? updated : t));
                }
                // No longer active — remove
                return prev.filter((t) => t.id !== updated.id);
              }
              return prev;
            });
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  // Realtime: memories
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`now-memories:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'memories', filter: `user_id=eq.${userId}` },
        (payload) => {
          const m = payload.new as RecentMemory;
          setRecentMemories((prev) => [m, ...prev].slice(0, 5));
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  async function deleteMemory(id: string) {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;
    await fetch(`${BACKEND_URL}/memories/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    setRecentMemories((prev) => prev.filter((m) => m.id !== id));
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4 text-sm">
      {/* Active tasks */}
      <Section title="Active" count={activeTasks.length} action={<Link href="/tasks" className="text-fg-subtle hover:text-fg">All tasks →</Link>}>
        {activeTasks.length === 0 ? (
          <Empty hint="No background work right now." />
        ) : (
          <div className="space-y-2">
            {activeTasks.map((t) => (
              <div key={t.id} className="rounded-md border border-border bg-surface px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-medium">{TASK_TYPE_LABELS[t.type] ?? t.type}</p>
                  <Badge variant={STATUS_VARIANT[t.status]} size="sm" dot>{t.status}</Badge>
                </div>
                <p className="mt-0.5 truncate text-xs text-fg-muted">{summarizeTask(t)}</p>
                {t.progress_message && (
                  <p className="mt-1 truncate text-[11px] text-warning">{t.progress_message}</p>
                )}
                <p className="mt-1 text-[10px] text-fg-subtle">started {t.started_at ? ageAgo(t.started_at) : ageAgo(t.created_at)} ago</p>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Recent memories */}
      <Section
        title="Just learned"
        count={recentMemories.length}
        action={<Link href="/memories" className="text-fg-subtle hover:text-fg">All →</Link>}
      >
        {loading ? (
          <Empty hint="Loading..." />
        ) : recentMemories.length === 0 ? (
          <Empty hint="No saved memories yet. Tell me about yourself." />
        ) : (
          <div className="space-y-1.5">
            {recentMemories.map((m) => (
              <div
                key={m.id}
                className="group rounded-md border border-border bg-surface px-3 py-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs leading-relaxed">{m.content}</p>
                  <button
                    onClick={() => deleteMemory(m.id)}
                    aria-label="Forget this memory"
                    className="shrink-0 text-[10px] text-fg-subtle opacity-0 transition-opacity hover:text-error focus:outline focus:outline-1 focus:outline-error focus:opacity-100 group-hover:opacity-100"
                    title="Forget"
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  {m.always_inject && <Badge variant="success" size="sm">always</Badge>}
                  <span className="text-[10px] text-fg-subtle">{m.category ?? 'note'} · {ageAgo(m.created_at)} ago</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6 last:mb-0">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
          {title}
          {typeof count === 'number' && count > 0 && (
            <span className="ml-1.5 text-fg-muted">{count}</span>
          )}
        </h3>
        {action && <span className="text-[10px]">{action}</span>}
      </div>
      {children}
    </div>
  );
}

function Empty({ hint }: { hint: string }) {
  return (
    <div className="rounded-md border border-dashed border-border px-3 py-3 text-center">
      <p className="text-[11px] text-fg-subtle">{hint}</p>
    </div>
  );
}
