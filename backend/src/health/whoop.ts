/**
 * Whoop API client.
 *
 * Fetches the daily snapshots we care about (recovery, sleep, cycle,
 * workout) and turns them into health_metrics rows. Uses the Whoop
 * Developer V1 API.
 *
 * Reference: https://developer.whoop.com/api/
 *
 * Sync model: each call asks for items created since `since`, paginated.
 * The sync handler tracks a per-connector cursor in `connectors.sync_cursor`
 * (ISO timestamp of the most recent `created_at` we've ingested).
 */
import { getValidWhoopAccessToken } from '../connectors/whoop-oauth.js';

const API_BASE = 'https://api.prod.whoop.com/developer';

interface PaginatedResponse<T> {
  records: T[];
  next_token?: string;
}

interface WhoopRecovery {
  cycle_id: number;
  sleep_id?: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  score_state: 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE';
  score?: {
    user_calibrating: boolean;
    recovery_score: number;        // 0–100
    resting_heart_rate: number;    // bpm
    hrv_rmssd_milli: number;       // ms (renamed from hrv_rmssd_ms in v1)
    spo2_percentage?: number;
    skin_temp_celsius?: number;
  };
}

interface WhoopSleep {
  id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end: string;
  timezone_offset: string;
  nap: boolean;
  score_state: string;
  score?: {
    stage_summary: {
      total_in_bed_time_milli: number;
      total_awake_time_milli: number;
      total_no_data_time_milli: number;
      total_light_sleep_time_milli: number;
      total_slow_wave_sleep_time_milli: number;
      total_rem_sleep_time_milli: number;
      sleep_cycle_count: number;
      disturbance_count: number;
    };
    sleep_needed: { baseline_milli: number; need_from_sleep_debt_milli: number; need_from_recent_strain_milli: number; need_from_recent_nap_milli: number };
    respiratory_rate?: number;
    sleep_performance_percentage?: number;
    sleep_consistency_percentage?: number;
    sleep_efficiency_percentage?: number;
  };
}

interface WhoopCycle {
  id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end?: string;
  timezone_offset: string;
  score_state: string;
  score?: {
    strain: number;             // 0–21
    kilojoule: number;
    average_heart_rate: number;
    max_heart_rate: number;
  };
}

interface WhoopWorkout {
  id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end: string;
  timezone_offset: string;
  sport_id: number;
  score_state: string;
  score?: {
    strain: number;
    average_heart_rate: number;
    max_heart_rate: number;
    kilojoule: number;
    distance_meter?: number;
    altitude_gain_meter?: number;
    altitude_change_meter?: number;
  };
}

async function fetchPaginated<T>(params: {
  credentialId: string;
  path: string;
  start?: string;
  end?: string;
  cap?: number;
}): Promise<T[]> {
  const cap = params.cap ?? 200;
  const out: T[] = [];
  let nextToken: string | undefined;

  while (out.length < cap) {
    const url = new URL(`${API_BASE}${params.path}`);
    url.searchParams.set('limit', '25');
    if (params.start) url.searchParams.set('start', params.start);
    if (params.end) url.searchParams.set('end', params.end);
    if (nextToken) url.searchParams.set('nextToken', nextToken);

    const accessToken = await getValidWhoopAccessToken(params.credentialId);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Whoop ${params.path} error (${res.status}): ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as PaginatedResponse<T>;
    out.push(...(data.records ?? []));
    if (!data.next_token) break;
    nextToken = data.next_token;
  }

  return out.slice(0, cap);
}

export function fetchRecoveries(params: { credentialId: string; start?: string; end?: string }) {
  return fetchPaginated<WhoopRecovery>({ ...params, path: '/v1/recovery' });
}

export function fetchSleeps(params: { credentialId: string; start?: string; end?: string }) {
  return fetchPaginated<WhoopSleep>({ ...params, path: '/v1/activity/sleep' });
}

export function fetchCycles(params: { credentialId: string; start?: string; end?: string }) {
  return fetchPaginated<WhoopCycle>({ ...params, path: '/v1/cycle' });
}

export function fetchWorkouts(params: { credentialId: string; start?: string; end?: string }) {
  return fetchPaginated<WhoopWorkout>({ ...params, path: '/v1/activity/workout' });
}

/**
 * Flatten a batch of Whoop responses into the long-format rows our
 * health_metrics table expects. One row per (metric, recorded_at).
 *
 * `recorded_at` for daily metrics is the cycle's `start` time; for
 * sleep, the wake time; for workouts, the workout's `end`. This keeps
 * the timeline meaningful when querying "last week's recovery scores".
 */
export interface HealthMetricRow {
  metric: string;
  value: number;
  unit: string;
  recorded_at: string;
  source: 'whoop';
}

export function recoveriesToMetrics(items: WhoopRecovery[]): HealthMetricRow[] {
  const rows: HealthMetricRow[] = [];
  for (const r of items) {
    if (!r.score || r.score_state !== 'SCORED') continue;
    rows.push({
      metric: 'recovery_score',
      value: r.score.recovery_score,
      unit: '%',
      recorded_at: r.created_at,
      source: 'whoop',
    });
    rows.push({
      metric: 'resting_heart_rate',
      value: r.score.resting_heart_rate,
      unit: 'bpm',
      recorded_at: r.created_at,
      source: 'whoop',
    });
    rows.push({
      metric: 'hrv_rmssd',
      value: r.score.hrv_rmssd_milli,
      unit: 'ms',
      recorded_at: r.created_at,
      source: 'whoop',
    });
    if (typeof r.score.spo2_percentage === 'number') {
      rows.push({
        metric: 'spo2',
        value: r.score.spo2_percentage,
        unit: '%',
        recorded_at: r.created_at,
        source: 'whoop',
      });
    }
  }
  return rows;
}

export function sleepsToMetrics(items: WhoopSleep[]): HealthMetricRow[] {
  const rows: HealthMetricRow[] = [];
  for (const s of items) {
    if (!s.score || s.nap) continue; // only main sleep, not naps
    const stages = s.score.stage_summary;
    const inBedHours = stages.total_in_bed_time_milli / 1000 / 60 / 60;
    const awakeHours = stages.total_awake_time_milli / 1000 / 60 / 60;
    const sleepHours = inBedHours - awakeHours;
    rows.push({
      metric: 'sleep_hours',
      value: Math.round(sleepHours * 100) / 100,
      unit: 'hours',
      recorded_at: s.end,
      source: 'whoop',
    });
    if (typeof s.score.sleep_efficiency_percentage === 'number') {
      rows.push({
        metric: 'sleep_efficiency',
        value: s.score.sleep_efficiency_percentage,
        unit: '%',
        recorded_at: s.end,
        source: 'whoop',
      });
    }
    if (typeof s.score.sleep_performance_percentage === 'number') {
      rows.push({
        metric: 'sleep_performance',
        value: s.score.sleep_performance_percentage,
        unit: '%',
        recorded_at: s.end,
        source: 'whoop',
      });
    }
    if (typeof s.score.respiratory_rate === 'number') {
      rows.push({
        metric: 'respiratory_rate',
        value: s.score.respiratory_rate,
        unit: 'breaths/min',
        recorded_at: s.end,
        source: 'whoop',
      });
    }
  }
  return rows;
}

export function cyclesToMetrics(items: WhoopCycle[]): HealthMetricRow[] {
  const rows: HealthMetricRow[] = [];
  for (const c of items) {
    if (!c.score) continue;
    rows.push({
      metric: 'strain',
      value: Math.round(c.score.strain * 10) / 10,
      unit: 'whoop_strain',
      recorded_at: c.created_at,
      source: 'whoop',
    });
    rows.push({
      metric: 'avg_heart_rate',
      value: c.score.average_heart_rate,
      unit: 'bpm',
      recorded_at: c.created_at,
      source: 'whoop',
    });
    rows.push({
      metric: 'max_heart_rate',
      value: c.score.max_heart_rate,
      unit: 'bpm',
      recorded_at: c.created_at,
      source: 'whoop',
    });
    rows.push({
      metric: 'energy_burned',
      value: Math.round(c.score.kilojoule),
      unit: 'kJ',
      recorded_at: c.created_at,
      source: 'whoop',
    });
  }
  return rows;
}

export function workoutsToMetrics(items: WhoopWorkout[]): HealthMetricRow[] {
  const rows: HealthMetricRow[] = [];
  for (const w of items) {
    if (!w.score) continue;
    rows.push({
      metric: 'workout_strain',
      value: Math.round(w.score.strain * 10) / 10,
      unit: 'whoop_strain',
      recorded_at: w.end,
      source: 'whoop',
    });
  }
  return rows;
}
