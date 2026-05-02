/**
 * health_metrics persistence helpers.
 *
 * The table is keyed `(user_id, metric, recorded_at)` with a UNIQUE
 * constraint, so upsert-by-conflict is safe and idempotent — re-running
 * a sync over the same time window won't duplicate rows.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import type { HealthMetricRow } from './whoop.js';

function getServiceClient() {
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
}

export async function upsertHealthMetrics(params: {
  userId: string;
  rows: HealthMetricRow[];
}): Promise<{ inserted: number }> {
  if (params.rows.length === 0) return { inserted: 0 };
  const db = getServiceClient();
  const { error } = await db
    .from('health_metrics')
    .upsert(
      params.rows.map((r) => ({
        user_id: params.userId,
        metric: r.metric,
        value: r.value,
        unit: r.unit,
        recorded_at: r.recorded_at,
        source: r.source,
      })),
      { onConflict: 'user_id,metric,recorded_at' },
    );
  if (error) throw error;
  return { inserted: params.rows.length };
}

/** Recent metrics across all kinds, newest first. Used by the agent tool. */
export async function getRecentHealthMetrics(params: {
  userId: string;
  metric?: string;
  days?: number;
  limit?: number;
}): Promise<Array<{ metric: string; value: number; unit: string; recorded_at: string; source: string | null }>> {
  const db = getServiceClient();
  const days = params.days ?? 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  let q = db
    .from('health_metrics')
    .select('metric, value, unit, recorded_at, source')
    .eq('user_id', params.userId)
    .gte('recorded_at', since)
    .order('recorded_at', { ascending: false })
    .limit(params.limit ?? 200);
  if (params.metric) q = q.eq('metric', params.metric);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}
