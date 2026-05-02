/**
 * whoop.sync task handler.
 *
 * Pulls recovery, sleep, cycle, and workout records from Whoop and writes
 * them to health_metrics. Uses `connectors.sync_cursor` (an ISO timestamp)
 * to do incremental syncs after the first backfill.
 *
 * Input shape:
 *   { connectorId: string, backfill?: boolean }
 *
 * Backfill: pulls the last 30 days. Incremental: pulls everything created
 * since the last cursor.
 */
import type { TaskHandler, TaskRow, RunResult } from '../types.js';
import { createClient } from '@supabase/supabase-js';
import { config } from '../../config.js';
import {
  fetchRecoveries,
  fetchSleeps,
  fetchCycles,
  fetchWorkouts,
  recoveriesToMetrics,
  sleepsToMetrics,
  cyclesToMetrics,
  workoutsToMetrics,
  type HealthMetricRow,
} from '../../health/whoop.js';
import { upsertHealthMetrics } from '../../health/db.js';
import {
  getConnectorSyncCursor,
  setConnectorSyncCursor,
} from '../../ingestion/events-db.js';

interface WhoopSyncInput {
  connectorId: string;
  backfill?: boolean;
}

interface SyncStats {
  was_backfill: boolean;
  recoveries: number;
  sleeps: number;
  cycles: number;
  workouts: number;
  metrics_upserted: number;
}

async function getConnector(connectorId: string) {
  const db = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
  const { data } = await db
    .from('connectors')
    .select('user_id, credential_id')
    .eq('id', connectorId)
    .single<{ user_id: string; credential_id: string }>();
  return data;
}

export const whoopSyncHandler: TaskHandler = {
  type: 'whoop.sync',
  provider: 'whoop',

  async run(task: TaskRow): Promise<RunResult> {
    const input = task.input as unknown as WhoopSyncInput;
    if (!input.connectorId) {
      return { status: 'failed', output: { error: 'connectorId required' } };
    }

    const connector = await getConnector(input.connectorId);
    if (!connector) {
      return { status: 'failed', output: { error: 'connector not found' } };
    }

    const cursor = input.backfill ? null : await getConnectorSyncCursor(input.connectorId);
    const useBackfill = Boolean(!cursor || input.backfill);

    // Backfill: 30 days. Incremental: from cursor.
    const start = useBackfill
      ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      : cursor!;

    // Pull all four endpoints in parallel — they hit independent Whoop
    // resources and the API permits concurrent calls.
    const [recoveries, sleeps, cycles, workouts] = await Promise.all([
      fetchRecoveries({ credentialId: connector.credential_id, start }),
      fetchSleeps({ credentialId: connector.credential_id, start }),
      fetchCycles({ credentialId: connector.credential_id, start }),
      fetchWorkouts({ credentialId: connector.credential_id, start }),
    ]);

    const metricRows: HealthMetricRow[] = [
      ...recoveriesToMetrics(recoveries),
      ...sleepsToMetrics(sleeps),
      ...cyclesToMetrics(cycles),
      ...workoutsToMetrics(workouts),
    ];

    await upsertHealthMetrics({ userId: connector.user_id, rows: metricRows });

    // Cursor = the latest `created_at` we've seen. Next run starts from here.
    const allCreatedAt = [
      ...recoveries.map((r) => r.created_at),
      ...sleeps.map((s) => s.created_at),
      ...cycles.map((c) => c.created_at),
      ...workouts.map((w) => w.created_at),
    ];
    if (allCreatedAt.length > 0) {
      const newest = allCreatedAt.reduce((max, t) => (t > max ? t : max), allCreatedAt[0]);
      await setConnectorSyncCursor(input.connectorId, newest);
    } else if (useBackfill) {
      // Empty backfill — anchor cursor to "now" so the next incremental run
      // doesn't try to reingest the empty 30-day window.
      await setConnectorSyncCursor(input.connectorId, new Date().toISOString());
    }

    const stats: SyncStats = {
      was_backfill: useBackfill,
      recoveries: recoveries.length,
      sleeps: sleeps.length,
      cycles: cycles.length,
      workouts: workouts.length,
      metrics_upserted: metricRows.length,
    };

    return { status: 'completed', output: stats as unknown as Record<string, unknown> };
  },
};
