'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/toast';
import { AppShell } from '@/components/app-shell';
import {
  formatHealthValue,
  formatNumber,
  formatRelative,
  formatShortDate,
} from '@/lib/format';

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

const KIND_META: Record<Kind, { label: string; icon: string }> = {
  calendar: { label: 'Calendar', icon: '📅' },
  gmail_structured: { label: 'Bills · receipts · travel', icon: '✉️' },
  memory: { label: 'Facts learned', icon: '🧠' },
  banking: { label: 'Banking', icon: '🏦' },
  health: { label: 'Health', icon: '💚' },
};

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
        ...data.buckets.flatMap((b) =>
          [b.counts.calendar, b.counts.gmail_structured, b.counts.memory, b.counts.banking, b.counts.health],
        ),
      )
    : 1;

  const allEmpty =
    !!data && (Object.keys(KIND_META) as Kind[]).every((k) => data.totals[k] === 0);

  return (
    <AppShell>
      {/* Hero */}
      <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 pt-8 pb-6">
        <h1 className="font-serif text-3xl font-medium tracking-tight">What&apos;s new</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Recent additions to your memory graph — last {data?.days ?? 7} days.
        </p>
      </div>

      <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 pb-16 space-y-8">
        {loading && <SkeletonInsights />}

        {data && !loading && (
          <>
            {/* Totals */}
            <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5 fade-in">
              {(Object.keys(KIND_META) as Kind[]).map((k) => (
                <div
                  key={k}
                  className="rounded-xl border border-border bg-surface px-4 py-3 transition-colors hover:border-border-strong"
                >
                  <p className="text-xs text-fg-muted">
                    <span className="mr-1.5">{KIND_META[k].icon}</span>
                    {KIND_META[k].label}
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    {formatNumber(data.totals[k])}
                  </p>
                </div>
              ))}
            </section>

            {/* Per-day spark grid — overflow-x-auto so it never blows out */}
            {!allEmpty && (
              <section className="rounded-xl border border-border bg-surface p-4 sm:p-5 fade-in">
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                    Daily activity
                  </h2>
                  <p className="text-[10px] text-fg-subtle tabular-nums">
                    {formatShortDate(data.buckets[0].date)} – {formatShortDate(data.buckets[data.buckets.length - 1].date)}
                  </p>
                </div>

                <div className="overflow-x-auto -mx-1 px-1">
                  <div className="min-w-[420px] space-y-2.5">
                    {(Object.keys(KIND_META) as Kind[])
                      .filter((k) => data.totals[k] > 0)
                      .map((k) => (
                        <div key={k} className="flex items-center gap-3">
                          <div className="w-32 shrink-0 truncate text-xs text-fg-muted">
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
                                  className="group relative flex flex-1 flex-col items-center gap-0.5"
                                  title={`${formatShortDate(b.date)}: ${c}`}
                                >
                                  <div className="flex h-7 w-full items-end">
                                    <div
                                      className={`w-full rounded-sm transition-all ${
                                        c > 0 ? 'bg-accent' : 'bg-surface-2'
                                      }`}
                                      style={{ height: `${Math.max(heightPct, c > 0 ? 12 : 6)}%` }}
                                    />
                                  </div>
                                  <span className="text-[9px] tabular-nums text-fg-subtle">
                                    {c > 0 ? formatNumber(c) : ''}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </section>
            )}

            {/* Recent additions */}
            {!allEmpty && (
              <section className="space-y-4 fade-in">
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
                      sub: c.start_at ? formatShortDate(c.start_at) : 'no time',
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
              </section>
            )}

            {allEmpty && (
              <div className="rounded-xl border border-border bg-surface p-12 text-center fade-in">
                <div className="mb-3 text-4xl">🌱</div>
                <p className="font-serif text-xl">Your graph is fresh</p>
                <p className="mt-2 text-sm text-fg-muted">
                  Connect a calendar, email, or wearable and your assistant will
                  start building a picture of your week here.
                </p>
                <Link
                  href="/connectors"
                  className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold accent-on-bg transition-opacity hover:opacity-90"
                >
                  Connect a source →
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
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
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span>{icon}</span>
        <h3 className="text-xs font-semibold">{title}</h3>
        <span className="ml-auto text-[10px] text-fg-subtle tabular-nums">
          {formatNumber(items.length)} recent
        </span>
      </div>
      <ul className="divide-y divide-border">
        {items.map((it) => (
          <li key={it.id} className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-fg">{it.title}</p>
              {it.sub && <p className="truncate text-[11px] text-fg-subtle capitalize">{it.sub}</p>}
            </div>
            <span className="shrink-0 text-[10px] tabular-nums text-fg-subtle">
              {formatRelative(it.when)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SkeletonInsights() {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl skeleton" />
        ))}
      </div>
      <div className="h-44 rounded-xl skeleton" />
      <div className="h-64 rounded-xl skeleton" />
    </div>
  );
}
