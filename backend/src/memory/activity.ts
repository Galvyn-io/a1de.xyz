/**
 * Pure aggregation logic for the /memories/activity endpoint.
 *
 * Kept separate from the HTTP router so it can be unit-tested without
 * mocking Supabase. The router does the queries and feeds the rows in
 * here; this module decides how to bucket them.
 */

export type ActivityKind = 'calendar' | 'gmail_structured' | 'memory' | 'banking';

export interface EventRow {
  id: string;
  title: string | null;
  source: string;
  start_at: string | null;
  created_at: string;
}

export interface MemoryRow {
  id: string;
  content: string;
  source: string | null;
  category: string | null;
  created_at: string;
}

export interface ActivityBucket {
  date: string;            // YYYY-MM-DD
  counts: Record<ActivityKind, number>;
}

export interface ActivityResponse {
  days: number;
  buckets: ActivityBucket[];
  totals: Record<ActivityKind, number>;
  recent: {
    calendar: EventRow[];
    gmail_structured: EventRow[];
    memory: MemoryRow[];
  };
}

const RECENT_PER_KIND = 8;

function emptyCounts(): Record<ActivityKind, number> {
  return { calendar: 0, gmail_structured: 0, memory: 0, banking: 0 };
}

/**
 * Map a row's `source` field to one of the activity kinds.
 * Returns null for unknown sources (we silently drop them — the activity
 * feed is intentionally a curated set, not "everything in the table").
 */
export function classifyEventSource(source: string): ActivityKind | null {
  if (source === 'google_calendar') return 'calendar';
  if (source.startsWith('gmail_')) return 'gmail_structured';
  if (source.startsWith('plaid')) return 'banking';
  return null;
}

/**
 * Build the activity payload from the raw rows.
 *
 * `now` is injected so tests can pin time. In production the caller passes
 * `new Date()`.
 */
export function buildActivity(params: {
  events: EventRow[];
  memories: MemoryRow[];
  days: number;
  now: Date;
}): ActivityResponse {
  const { events, memories, days } = params;
  const now = params.now.getTime();

  const buckets = new Map<string, Record<ActivityKind, number>>();
  function bump(date: string, kind: ActivityKind): void {
    if (!buckets.has(date)) buckets.set(date, emptyCounts());
    buckets.get(date)![kind]++;
  }

  for (const e of events) {
    const k = classifyEventSource(e.source);
    if (!k) continue;
    bump(e.created_at.slice(0, 10), k);
  }
  for (const m of memories) {
    bump(m.created_at.slice(0, 10), 'memory');
  }

  // Continuous date strip from oldest → newest, zero-filled
  const bucketArray: ActivityBucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    bucketArray.push({ date: d, counts: buckets.get(d) ?? emptyCounts() });
  }

  const totals = bucketArray.reduce((acc, b) => {
    acc.calendar += b.counts.calendar;
    acc.gmail_structured += b.counts.gmail_structured;
    acc.memory += b.counts.memory;
    acc.banking += b.counts.banking;
    return acc;
  }, emptyCounts());

  return {
    days,
    buckets: bucketArray,
    totals,
    recent: {
      calendar: events.filter((e) => e.source === 'google_calendar').slice(0, RECENT_PER_KIND),
      gmail_structured: events.filter((e) => e.source.startsWith('gmail_')).slice(0, RECENT_PER_KIND),
      memory: memories.slice(0, RECENT_PER_KIND),
    },
  };
}
