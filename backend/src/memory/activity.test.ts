import { describe, it, expect } from 'vitest';
import { buildActivity, classifyEventSource, type EventRow, type MemoryRow } from './activity.js';

const NOW = new Date('2026-05-01T12:00:00Z');

function ev(partial: Partial<EventRow> & { source: string; created_at: string }): EventRow {
  return {
    id: partial.id ?? 'e-' + Math.random().toString(36).slice(2),
    title: partial.title ?? null,
    start_at: partial.start_at ?? null,
    ...partial,
  };
}

function mem(partial: Partial<MemoryRow> & { created_at: string }): MemoryRow {
  return {
    id: partial.id ?? 'm-' + Math.random().toString(36).slice(2),
    content: partial.content ?? '',
    source: partial.source ?? null,
    category: partial.category ?? null,
    ...partial,
  };
}

describe('classifyEventSource', () => {
  it('maps known prefixes to kinds', () => {
    expect(classifyEventSource('google_calendar')).toBe('calendar');
    expect(classifyEventSource('gmail_bill')).toBe('gmail_structured');
    expect(classifyEventSource('gmail_receipt')).toBe('gmail_structured');
    expect(classifyEventSource('plaid_transaction')).toBe('banking');
  });
  it('returns null for unknown sources', () => {
    expect(classifyEventSource('mystery')).toBeNull();
    expect(classifyEventSource('')).toBeNull();
  });
});

describe('buildActivity', () => {
  it('produces a continuous date strip even when no rows exist', () => {
    const result = buildActivity({ events: [], memories: [], days: 7, now: NOW });
    expect(result.days).toBe(7);
    expect(result.buckets).toHaveLength(7);
    // Last bucket is "today" relative to NOW
    expect(result.buckets[6].date).toBe('2026-05-01');
    expect(result.buckets[0].date).toBe('2026-04-25');
    // All counts zero
    for (const b of result.buckets) {
      expect(b.counts).toEqual({ calendar: 0, gmail_structured: 0, memory: 0, banking: 0 });
    }
    expect(result.totals).toEqual({ calendar: 0, gmail_structured: 0, memory: 0, banking: 0 });
  });

  it('counts events by kind into the right date bucket', () => {
    const result = buildActivity({
      events: [
        ev({ source: 'google_calendar', created_at: '2026-04-30T10:00:00Z' }),
        ev({ source: 'google_calendar', created_at: '2026-04-30T11:00:00Z' }),
        ev({ source: 'gmail_bill', created_at: '2026-04-29T08:00:00Z' }),
        ev({ source: 'plaid_transaction', created_at: '2026-04-29T09:00:00Z' }),
        ev({ source: 'mystery', created_at: '2026-04-30T13:00:00Z' }), // dropped
      ],
      memories: [
        mem({ created_at: '2026-05-01T10:00:00Z' }),
      ],
      days: 7,
      now: NOW,
    });
    const apr30 = result.buckets.find((b) => b.date === '2026-04-30')!;
    const apr29 = result.buckets.find((b) => b.date === '2026-04-29')!;
    const may01 = result.buckets.find((b) => b.date === '2026-05-01')!;
    expect(apr30.counts.calendar).toBe(2);
    expect(apr29.counts.gmail_structured).toBe(1);
    expect(apr29.counts.banking).toBe(1);
    expect(may01.counts.memory).toBe(1);
    expect(result.totals).toEqual({ calendar: 2, gmail_structured: 1, memory: 1, banking: 1 });
  });

  it('drops events with unrecognized sources but includes all memory rows', () => {
    const result = buildActivity({
      events: [ev({ source: 'unknown', created_at: '2026-04-30T10:00:00Z' })],
      memories: [
        mem({ source: null, created_at: '2026-04-30T10:00:00Z' }),
        mem({ source: 'chat', created_at: '2026-04-30T10:00:00Z' }),
      ],
      days: 3,
      now: NOW,
    });
    expect(result.totals.memory).toBe(2);
    expect(result.totals.calendar + result.totals.gmail_structured + result.totals.banking).toBe(0);
  });

  it('caps recent items at 8 per kind', () => {
    const events = Array.from({ length: 15 }, (_, i) =>
      ev({ source: 'google_calendar', created_at: '2026-05-01T10:00:00Z', id: 'cal-' + i }),
    );
    const result = buildActivity({ events, memories: [], days: 7, now: NOW });
    expect(result.recent.calendar).toHaveLength(8);
  });

  it('clamps days within reasonable bounds at the caller — buildActivity respects the input', () => {
    // Sanity check: caller is responsible for clamping; the function itself
    // accepts whatever `days` it gets and returns that many buckets.
    const result = buildActivity({ events: [], memories: [], days: 1, now: NOW });
    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0].date).toBe('2026-05-01');
  });
});
