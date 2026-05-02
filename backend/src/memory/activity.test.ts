import { describe, it, expect } from 'vitest';
import {
  buildActivity,
  classifyEventSource,
  type EventRow,
  type MemoryRow,
  type HealthMetricRow,
} from './activity.js';

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

function hm(partial: Partial<HealthMetricRow> & { recorded_at: string }): HealthMetricRow {
  return {
    id: partial.id ?? 'h-' + Math.random().toString(36).slice(2),
    metric: partial.metric ?? 'recovery_score',
    value: partial.value ?? 70,
    unit: partial.unit ?? '%',
    source: partial.source ?? 'whoop',
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
    const result = buildActivity({ events: [], memories: [], health: [], days: 7, now: NOW });
    expect(result.days).toBe(7);
    expect(result.buckets).toHaveLength(7);
    // Last bucket is "today" relative to NOW
    expect(result.buckets[6].date).toBe('2026-05-01');
    expect(result.buckets[0].date).toBe('2026-04-25');
    const zero = { calendar: 0, gmail_structured: 0, memory: 0, banking: 0, health: 0 };
    for (const b of result.buckets) {
      expect(b.counts).toEqual(zero);
    }
    expect(result.totals).toEqual(zero);
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
      health: [
        hm({ recorded_at: '2026-05-01T07:30:00Z', metric: 'recovery_score' }),
        hm({ recorded_at: '2026-04-30T07:30:00Z', metric: 'sleep_hours' }),
      ],
      days: 7,
      now: NOW,
    });
    const apr30 = result.buckets.find((b) => b.date === '2026-04-30')!;
    const apr29 = result.buckets.find((b) => b.date === '2026-04-29')!;
    const may01 = result.buckets.find((b) => b.date === '2026-05-01')!;
    expect(apr30.counts.calendar).toBe(2);
    expect(apr30.counts.health).toBe(1);
    expect(apr29.counts.gmail_structured).toBe(1);
    expect(apr29.counts.banking).toBe(1);
    expect(may01.counts.memory).toBe(1);
    expect(may01.counts.health).toBe(1);
    expect(result.totals).toEqual({
      calendar: 2, gmail_structured: 1, memory: 1, banking: 1, health: 2,
    });
  });

  it('drops events with unrecognized sources but includes all memory rows', () => {
    const result = buildActivity({
      events: [ev({ source: 'unknown', created_at: '2026-04-30T10:00:00Z' })],
      memories: [
        mem({ source: null, created_at: '2026-04-30T10:00:00Z' }),
        mem({ source: 'chat', created_at: '2026-04-30T10:00:00Z' }),
      ],
      health: [],
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
    const health = Array.from({ length: 12 }, (_, i) =>
      hm({ recorded_at: '2026-05-01T07:00:00Z', id: 'h-' + i, metric: 'recovery_score' }),
    );
    const result = buildActivity({ events, memories: [], health, days: 7, now: NOW });
    expect(result.recent.calendar).toHaveLength(8);
    expect(result.recent.health).toHaveLength(8);
  });

  it('clamps days within reasonable bounds at the caller — buildActivity respects the input', () => {
    // Sanity check: caller is responsible for clamping; the function itself
    // accepts whatever `days` it gets and returns that many buckets.
    const result = buildActivity({ events: [], memories: [], health: [], days: 1, now: NOW });
    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0].date).toBe('2026-05-01');
  });
});
