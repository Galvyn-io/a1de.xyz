'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { Task, TaskStatus } from '@/lib/supabase/types';

const STATUS_META: Record<TaskStatus, { label: string; color: string; dot: string }> = {
  pending: { label: 'Pending', color: 'text-zinc-400', dot: 'bg-zinc-500' },
  running: { label: 'Running', color: 'text-amber-400', dot: 'bg-amber-400 animate-pulse' },
  completed: { label: 'Completed', color: 'text-emerald-400', dot: 'bg-emerald-500' },
  failed: { label: 'Failed', color: 'text-red-400', dot: 'bg-red-500' },
  cancelled: { label: 'Cancelled', color: 'text-zinc-500', dot: 'bg-zinc-600' },
};

const TYPE_LABELS: Record<string, string> = {
  'golf.search': 'Golf — Check tee times',
  'golf.book': 'Golf — Book tee time',
  'memory.extract': 'Memory — Extract facts',
  'email.sync': 'Email — Sync',
  'calendar.sync': 'Calendar — Sync',
  'health.summary': 'Health — Daily summary',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

function formatAge(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function summarizeInput(task: Task): string {
  const input = task.input;
  if (!input) return '';
  if (task.type.startsWith('golf.')) {
    const { course_name, date, time } = input as { course_name?: string; date?: string; time?: string };
    return [course_name, date, time].filter(Boolean).join(' · ');
  }
  if (task.type === 'memory.extract') {
    const msg = (input as { userMessage?: string }).userMessage;
    return msg ? msg.slice(0, 80) + (msg.length > 80 ? '...' : '') : '';
  }
  return '';
}

function summarizeOutput(task: Task): string | null {
  if (task.status !== 'completed' || !task.output) return null;

  if (task.type === 'golf.search') {
    const teeTimes = (task.output as { tee_times?: unknown[] }).tee_times;
    if (Array.isArray(teeTimes)) {
      return `${teeTimes.length} tee time${teeTimes.length === 1 ? '' : 's'} found`;
    }
  }
  return null;
}

export function TasksView({ initialTasks, userId }: { initialTasks: Task[]; userId: string }) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [filter, setFilter] = useState<'active' | 'recent' | 'all'>('active');

  useEffect(() => {
    // Subscribe to realtime updates on this user's tasks
    const supabase = createClient();
    const channel = supabase
      .channel(`tasks:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${userId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setTasks((prev) => [payload.new as Task, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setTasks((prev) => prev.map((t) => (t.id === (payload.new as Task).id ? (payload.new as Task) : t)));
          } else if (payload.eventType === 'DELETE') {
            setTasks((prev) => prev.filter((t) => t.id !== (payload.old as Task).id));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const filtered = useMemo(() => {
    if (filter === 'active') {
      return tasks.filter((t) => t.status === 'pending' || t.status === 'running');
    }
    if (filter === 'recent') {
      const cutoff = Date.now() - 24 * 3600 * 1000;
      return tasks.filter((t) => new Date(t.created_at).getTime() > cutoff);
    }
    return tasks;
  }, [tasks, filter]);

  const counts = useMemo(
    () => ({
      active: tasks.filter((t) => t.status === 'pending' || t.status === 'running').length,
      recent: tasks.filter((t) => Date.now() - new Date(t.created_at).getTime() < 86_400_000).length,
      all: tasks.length,
    }),
    [tasks],
  );

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tasks</h1>
          <p className="mt-1 text-zinc-400">Background work your assistant is running</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1 text-sm">
          {(['active', 'recent', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1.5 transition-colors ${
                filter === f ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-12 text-center">
          <p className="text-zinc-400">
            {filter === 'active' ? 'No active tasks.' : 'No tasks yet.'}
          </p>
          <p className="mt-2 text-sm text-zinc-500">
            Tasks appear here when your assistant starts background work.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((t) => {
          const meta = STATUS_META[t.status];
          const typeLabel = TYPE_LABELS[t.type] ?? t.type;
          const inputSummary = summarizeInput(t);
          const outputSummary = summarizeOutput(t);
          const duration =
            t.completed_at && t.started_at
              ? formatDuration(new Date(t.completed_at).getTime() - new Date(t.started_at).getTime())
              : t.started_at && t.status === 'running'
                ? formatDuration(Date.now() - new Date(t.started_at).getTime())
                : null;

          return (
            <div
              key={t.id}
              className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3"
            >
              <div className="flex items-start gap-3">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{typeLabel}</p>
                      {inputSummary && (
                        <p className="text-xs text-zinc-400 truncate">{inputSummary}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-baseline gap-2 text-xs">
                      <span className={meta.color}>{meta.label}</span>
                      <span className="text-zinc-600">·</span>
                      <span className="text-zinc-600">{formatAge(t.created_at)}</span>
                    </div>
                  </div>
                  {t.progress_message && t.status === 'running' && (
                    <p className="mt-1 text-xs text-amber-400/80">{t.progress_message}</p>
                  )}
                  {outputSummary && (
                    <p className="mt-1 text-xs text-emerald-400/80">{outputSummary}</p>
                  )}
                  {t.error && (
                    <p className="mt-1 text-xs text-red-400/80">{t.error}</p>
                  )}
                  {(duration || t.conversation_id) && (
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-zinc-600">
                      {duration && <span>{duration}</span>}
                      {duration && t.conversation_id && <span>·</span>}
                      {t.conversation_id && (
                        <Link
                          href={`/chat/${t.conversation_id}`}
                          className="hover:text-zinc-400"
                        >
                          View chat
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-8 flex gap-4">
        <Link href="/chat" className="text-sm text-zinc-400 hover:text-zinc-200">Back to chat</Link>
        <Link href="/dashboard" className="text-sm text-zinc-400 hover:text-zinc-200">Dashboard</Link>
      </div>
    </div>
  );
}
