'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/toast';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? '';

type Kind = 'calendar' | 'gmail_structured' | 'memory' | 'banking' | 'health';

interface ActivityResponse {
  days: number;
  buckets: Array<{ date: string; counts: Record<Kind, number> }>;
  totals: Record<Kind, number>;
  recent: {
    calendar: Array<{ id: string; title: string | null; source: string; start_at: string | null; created_at: string }>;
    gmail_structured: Array<{ id: string; title: string | null; source: string; created_at: string }>;
    memory: Array<{ id: string; content: string; source: string | null; category: string | null; created_at: string }>;
    health: Array<{ id: string; metric: string; value: number; unit: string; source: string | null; recorded_at: string }>;
  };
}

const KIND_META: Record<Kind, { label: string; icon: string; color: string }> = {
  calendar: { label: 'Calendar events', icon: '📅', color: 'text-accent-text' },
  gmail_structured: { label: 'Bills · receipts · travel', icon: '✉️', color: 'text-fg' },
  memory: { label: 'Facts learned', icon: '🧠', color: 'text-fg' },
  banking: { label: 'Banking', icon: '🏦', color: 'text-fg' },
  health: { label: 'Health readings', icon: '💚', color: 'text-fg' },
};

// Compact human-readable formatting for the recent-readings list.
function formatHealthValue(metric: string, value: number, unit: string): string {
  if (unit === '%') return `${value}%`;
  if (unit === 'bpm') return `${value} bpm`;
  if (unit === 'ms') return `${value} ms`;
  if (unit === 'hours') return `${value}h`;
  if (unit === 'whoop_strain') return `${value} strain`;
  if (unit === 'kJ') return `${Math.round(value)} kJ`;
  return `${value} ${unit}`;
}

// Friendly metric labels — `recovery_score` → `Recovery`, etc.
const METRIC_LABELS: Record<string, string> = {
  recovery_score: 'Recovery',
  resting_heart_rate: 'Resting HR',
  hrv_rmssd: 'HRV',
  spo2: 'SpO₂',
  sleep_hours: 'Sleep',
  sleep_efficiency: 'Sleep efficiency',
  sleep_performance: 'Sleep performance',
  respiratory_rate: 'Respiratory rate',
  strain: 'Day strain',
  workout_strain: 'Workout strain',
  avg_heart_rate: 'Avg HR',
  max_heart_rate: 'Max HR',
  energy_burned: 'Energy',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function InsightsView() {
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${BACKEND_URL}/memories/activity?days=7`, {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const json = (await res.json()) as ActivityResponse;
        if (!cancelled) setData(json);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        if (!cancelled) toast(`Failed to load activity: ${msg}`, 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  // Per-kind max for the spark-grid scaling
  const maxCount = data
    ? Math.max(
        1,
        ...data.buckets.flatMap((b) => [b.counts.calendar, b.counts.gmail_structured, b.counts.memory, b.counts.banking]),
      )
    : 1;

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">What&apos;s new</h1>
            <p className="mt-0.5 text-xs text-fg-muted">Recent additions to your memory graph</p>
          </div>
          <nav className="flex items-center gap-3 text-xs">
            <Link href="/chat" className="text-fg-muted hover:text-fg">Chat</Link>
            <Link href="/memories" className="text-fg-muted hover:text-fg">Memories</Link>
            <Link href="/tasks" className="text-fg-muted hover:text-fg">Tasks</Link>
            <Link href="/connectors" className="text-fg-muted hover:text-fg">Connectors</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-6 space-y-8">
        {loading && <p className="text-sm text-fg-muted">Loading…</p>}

        {data && (
          <>
            {/* Totals */}
            <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {(Object.keys(KIND_META) as Kind[]).map((k) => (
                <div
                  key={k}
                  className="rounded-lg border border-border bg-surface px-4 py-3"
                >
                  <p className="text-xs text-fg-muted">
                    <span className="mr-1.5">{KIND_META[k].icon}</span>
                    {KIND_META[k].label}
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{data.totals[k]}</p>
                  <p className="text-[10px] text-fg-subtle">last {data.days} days</p>
                </div>
              ))}
            </section>

            {/* Per-day spark grid */}
            <section className="rounded-lg border border-border bg-surface p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                Daily activity
              </h2>
              <div className="mt-3 space-y-2">
                {(Object.keys(KIND_META) as Kind[])
                  .filter((k) => data.totals[k] > 0)
                  .map((k) => (
                    <div key={k} className="flex items-center gap-3">
                      <div className="w-44 shrink-0 text-xs text-fg-muted">
                        <span className="mr-1.5">{KIND_META[k].icon}</span>
                        {KIND_META[k].label}
                      </div>
                      <div className="flex flex-1 items-end gap-1">
                        {data.buckets.map((b) => {
                          const c = b.counts[k];
                          const heightPct = (c / maxCount) * 100;
                          return (
                            <div
                              key={b.date}
                              className="flex flex-1 flex-col items-center gap-0.5"
                              title={`${formatDate(b.date)}: ${c}`}
                            >
                              <div className="flex h-8 w-full items-end">
                                <div
                                  className={`w-full rounded-sm ${c > 0 ? 'bg-accent' : 'bg-surface-2'}`}
                                  style={{ height: `${Math.max(heightPct, c > 0 ? 8 : 4)}%` }}
                                />
                              </div>
                              <span className="text-[9px] text-fg-subtle tabular-nums">
                                {c > 0 ? c : ''}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                {(Object.keys(KIND_META) as Kind[]).every((k) => data.totals[k] === 0) && (
                  <p className="text-xs text-fg-subtle">
                    Nothing added in the last {data.days} days.
                  </p>
                )}
              </div>
              <div className="mt-2 flex items-center gap-1 text-[9px] text-fg-subtle">
                <div className="w-44 shrink-0" />
                <div className="flex flex-1 justify-between">
                  <span>{formatDate(data.buckets[0]?.date ?? new Date().toISOString())}</span>
                  <span>{formatDate(data.buckets[data.buckets.length - 1]?.date ?? new Date().toISOString())}</span>
                </div>
              </div>
            </section>

            {/* Recent additions */}
            <section className="space-y-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                Recent additions
              </h2>

              {data.recent.calendar.length > 0 && (
                <RecentList
                  title="Calendar events"
                  icon="📅"
                  items={data.recent.calendar.map((c) => ({
                    id: c.id,
                    title: c.title ?? '(untitled event)',
                    sub: c.start_at ? new Date(c.start_at).toLocaleString() : 'no time',
                    when: c.created_at,
                  }))}
                />
              )}

              {data.recent.gmail_structured.length > 0 && (
                <RecentList
                  title="Bills · receipts · travel · appointments"
                  icon="✉️"
                  items={data.recent.gmail_structured.map((g) => ({
                    id: g.id,
                    title: g.title ?? '(untitled)',
                    sub: g.source.replace('gmail_', '').replace(/_/g, ' '),
                    when: g.created_at,
                  }))}
                />
              )}

              {data.recent.health.length > 0 && (
                <RecentList
                  title="Health readings"
                  icon="💚"
                  items={data.recent.health.map((h) => ({
                    id: h.id,
                    title: `${METRIC_LABELS[h.metric] ?? h.metric}: ${formatHealthValue(h.metric, h.value, h.unit)}`,
                    sub: h.source ?? 'wearable',
                    when: h.recorded_at,
                  }))}
                />
              )}

              {data.recent.memory.length > 0 && (
                <RecentList
                  title="Facts learned"
                  icon="🧠"
                  items={data.recent.memory.map((m) => ({
                    id: m.id,
                    title: m.content,
                    sub: [m.category, m.source].filter(Boolean).join(' · '),
                    when: m.created_at,
                  }))}
                />
              )}

              {(Object.keys(KIND_META) as Kind[]).every((k) => data.totals[k] === 0) && (
                <p className="text-xs text-fg-subtle">
                  No recent items yet. Connect a calendar or email account on{' '}
                  <Link href="/connectors" className="text-accent-text underline">
                    /connectors
                  </Link>{' '}
                  to start populating the graph.
                </p>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function RecentList({
  title,
  icon,
  items,
}: {
  title: string;
  icon: string;
  items: Array<{ id: string; title: string; sub: string; when: string }>;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <span>{icon}</span>
        <h3 className="text-xs font-semibold">{title}</h3>
        <span className="ml-auto text-[10px] text-fg-subtle">
          {items.length} recent
        </span>
      </div>
      <ul className="divide-y divide-border">
        {items.map((it) => (
          <li key={it.id} className="flex items-center justify-between gap-3 px-4 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-fg">{it.title}</p>
              {it.sub && <p className="truncate text-[11px] text-fg-subtle">{it.sub}</p>}
            </div>
            <span className="shrink-0 text-[10px] text-fg-subtle tabular-nums">
              {timeAgo(it.when)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
