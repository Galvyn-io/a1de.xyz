/**
 * Tests for the pure mapping helpers that flatten Whoop API responses
 * into health_metrics rows. The fetchers themselves (network) are not
 * tested here — they're thin wrappers around `fetch`.
 *
 * We mock config so importing whoop.ts (which transitively reaches
 * config.ts via whoop-oauth.ts) doesn't try to parse process.env.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    SUPABASE_URL: 'http://test',
    SUPABASE_SERVICE_ROLE_KEY: 'test',
    OAUTH_STATE_SECRET: 'a'.repeat(32),
    OAUTH_CALLBACK_URL: 'https://example.com/connectors/google/callback',
  },
}));

import {
  recoveriesToMetrics,
  sleepsToMetrics,
  cyclesToMetrics,
  workoutsToMetrics,
} from './whoop.js';

describe('recoveriesToMetrics', () => {
  it('emits four metrics per scored recovery (recovery, RHR, HRV, SpO2)', () => {
    const rows = recoveriesToMetrics([
      {
        cycle_id: 1, user_id: 1,
        created_at: '2026-05-01T08:00:00Z', updated_at: '2026-05-01T08:00:00Z',
        score_state: 'SCORED',
        score: {
          user_calibrating: false,
          recovery_score: 72,
          resting_heart_rate: 54,
          hrv_rmssd_milli: 38,
          spo2_percentage: 96,
        },
      },
    ]);
    const metrics = rows.map((r) => r.metric).sort();
    expect(metrics).toEqual(['hrv_rmssd', 'recovery_score', 'resting_heart_rate', 'spo2']);
    expect(rows.find((r) => r.metric === 'hrv_rmssd')?.unit).toBe('ms');
  });

  it('skips unscored recoveries', () => {
    const rows = recoveriesToMetrics([
      {
        cycle_id: 1, user_id: 1,
        created_at: '2026-05-01T08:00:00Z', updated_at: '2026-05-01T08:00:00Z',
        score_state: 'PENDING_SCORE',
      },
    ]);
    expect(rows).toHaveLength(0);
  });
});

describe('sleepsToMetrics', () => {
  it('skips naps and computes hours from in-bed minus awake', () => {
    const rows = sleepsToMetrics([
      {
        id: 'sleep-uuid-1', user_id: 1,
        created_at: '2026-05-01T07:00:00Z', updated_at: '2026-05-01T07:00:00Z',
        start: '2026-04-30T23:00:00Z', end: '2026-05-01T07:00:00Z',
        timezone_offset: '-07:00', nap: false, score_state: 'SCORED',
        score: {
          stage_summary: {
            total_in_bed_time_milli: 8 * 60 * 60 * 1000,    // 8 hours in bed
            total_awake_time_milli: 30 * 60 * 1000,         // 30 min awake
            total_no_data_time_milli: 0,
            total_light_sleep_time_milli: 4 * 60 * 60 * 1000,
            total_slow_wave_sleep_time_milli: 1.5 * 60 * 60 * 1000,
            total_rem_sleep_time_milli: 2 * 60 * 60 * 1000,
            sleep_cycle_count: 4, disturbance_count: 2,
          },
          sleep_needed: { baseline_milli: 0, need_from_sleep_debt_milli: 0, need_from_recent_strain_milli: 0, need_from_recent_nap_milli: 0 },
          sleep_efficiency_percentage: 92,
        },
      },
      {
        id: 'sleep-uuid-2', user_id: 1,
        created_at: '2026-05-01T15:00:00Z', updated_at: '2026-05-01T15:00:00Z',
        start: '2026-05-01T14:00:00Z', end: '2026-05-01T15:00:00Z',
        timezone_offset: '-07:00', nap: true, score_state: 'SCORED',
        score: {
          stage_summary: {
            total_in_bed_time_milli: 0, total_awake_time_milli: 0, total_no_data_time_milli: 0,
            total_light_sleep_time_milli: 0, total_slow_wave_sleep_time_milli: 0, total_rem_sleep_time_milli: 0,
            sleep_cycle_count: 0, disturbance_count: 0,
          },
          sleep_needed: { baseline_milli: 0, need_from_sleep_debt_milli: 0, need_from_recent_strain_milli: 0, need_from_recent_nap_milli: 0 },
        },
      },
    ]);

    // Only the main sleep produces rows
    const sleepRow = rows.find((r) => r.metric === 'sleep_hours');
    expect(sleepRow).toBeDefined();
    expect(sleepRow!.value).toBeCloseTo(7.5, 1); // 8h in bed - 30m awake
    expect(rows.find((r) => r.metric === 'sleep_efficiency')?.value).toBe(92);

    // Nap was skipped — no second sleep_hours row
    expect(rows.filter((r) => r.metric === 'sleep_hours')).toHaveLength(1);
  });
});

describe('cyclesToMetrics', () => {
  it('emits strain + heart-rate metrics for scored cycles', () => {
    const rows = cyclesToMetrics([
      {
        id: 1, user_id: 1,
        created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T23:59:00Z',
        start: '2026-05-01T00:00:00Z', timezone_offset: '-07:00',
        score_state: 'SCORED',
        score: { strain: 14.7, kilojoule: 8200, average_heart_rate: 71, max_heart_rate: 162 },
      },
    ]);
    expect(rows.find((r) => r.metric === 'strain')?.value).toBe(14.7);
    expect(rows.find((r) => r.metric === 'avg_heart_rate')?.value).toBe(71);
    expect(rows.find((r) => r.metric === 'max_heart_rate')?.value).toBe(162);
    expect(rows.find((r) => r.metric === 'energy_burned')?.unit).toBe('kJ');
  });
});

describe('workoutsToMetrics', () => {
  it('records strain on workout end timestamp', () => {
    const rows = workoutsToMetrics([
      {
        id: 'workout-uuid-1', user_id: 1,
        created_at: '2026-05-01T17:00:00Z', updated_at: '2026-05-01T18:00:00Z',
        start: '2026-05-01T17:00:00Z', end: '2026-05-01T18:00:00Z',
        timezone_offset: '-07:00', sport_id: 0, score_state: 'SCORED',
        score: { strain: 9.3, average_heart_rate: 130, max_heart_rate: 168, kilojoule: 1800 },
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].metric).toBe('workout_strain');
    expect(rows[0].recorded_at).toBe('2026-05-01T18:00:00Z');
  });
});
