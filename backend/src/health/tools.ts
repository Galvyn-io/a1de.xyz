/**
 * Health tools exposed to Claude.
 *
 * Read-only queries over the user's health_metrics table (Whoop today,
 * Apple Health later). The agent uses these to answer questions like
 * "what was my recovery yesterday" or "how's my HRV trending".
 *
 * Pattern mirrors ingestion/tools.ts and memory/tools.ts.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { getRecentHealthMetrics } from './db.js';

// Curated list — kept in sync with whoop.ts mappers. Including this in the
// tool description helps Claude pick the right `metric` filter.
const KNOWN_METRICS = [
  'recovery_score',
  'resting_heart_rate',
  'hrv_rmssd',
  'spo2',
  'sleep_hours',
  'sleep_efficiency',
  'sleep_performance',
  'respiratory_rate',
  'strain',
  'avg_heart_rate',
  'max_heart_rate',
  'energy_burned',
  'workout_strain',
];

export const HEALTH_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_recent_health_metrics',
    description:
      "Read the user's recent health/fitness metrics from connected wearables (Whoop today, Apple Health later). " +
      'Use for questions about recovery, sleep, strain, heart rate, HRV, etc. ' +
      'Returns one row per metric reading, newest first. ' +
      `Known metric names: ${KNOWN_METRICS.join(', ')}. ` +
      'If the user asks about a specific metric (e.g. "what was my HRV last night"), filter by `metric`. ' +
      'If they ask broadly (e.g. "how am I doing this week"), omit `metric` to get a mix.',
    input_schema: {
      type: 'object' as const,
      properties: {
        metric: {
          type: 'string',
          description: `Optional: one of ${KNOWN_METRICS.join(' / ')}. Omit for all metrics.`,
        },
        days: {
          type: 'number',
          description: 'How many days back to look. Default 7, max 90.',
        },
        limit: {
          type: 'number',
          description: 'Max rows to return. Default 50, max 200.',
        },
      },
      required: [],
    },
  },
];

interface GetHealthMetricsInput {
  metric?: string;
  days?: number;
  limit?: number;
}

function formatValue(metric: string, value: number, unit: string): string {
  // Compact formatting for the most common units.
  if (unit === '%') return `${value}%`;
  if (unit === 'bpm') return `${value} bpm`;
  if (unit === 'ms') return `${value} ms`;
  if (unit === 'hours') return `${value}h`;
  if (unit === 'whoop_strain') return `${value}`;       // 0–21 scale
  if (unit === 'kJ') return `${Math.round(value)} kJ`;
  return `${value} ${unit}`;
}

export async function executeHealthTool(
  name: string,
  input: unknown,
  userId: string,
): Promise<string> {
  try {
    switch (name) {
      case 'get_recent_health_metrics': {
        const params = input as GetHealthMetricsInput;
        const days = Math.min(Math.max(params.days ?? 7, 1), 90);
        const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);

        const rows = await getRecentHealthMetrics({
          userId,
          metric: params.metric,
          days,
          limit,
        });

        if (rows.length === 0) {
          const filter = params.metric ? ` for ${params.metric}` : '';
          return `No health metrics found${filter} in the last ${days} days. The user may not have connected a wearable yet, or the latest sync hasn't run.`;
        }

        // Group by metric so the model gets a clean structure to summarize from.
        const byMetric = new Map<string, Array<{ value: number; unit: string; recorded_at: string; source: string | null }>>();
        for (const r of rows) {
          if (!byMetric.has(r.metric)) byMetric.set(r.metric, []);
          byMetric.get(r.metric)!.push({
            value: r.value,
            unit: r.unit,
            recorded_at: r.recorded_at,
            source: r.source,
          });
        }

        const sections: string[] = [];
        for (const [metric, values] of byMetric) {
          const lines = values.slice(0, 14).map((v) => {
            const when = new Date(v.recorded_at).toLocaleString('en-US', {
              month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
            });
            return `  - ${when}: ${formatValue(metric, v.value, v.unit)}${v.source ? ` (${v.source})` : ''}`;
          });
          sections.push(`${metric} (${values.length} reading${values.length === 1 ? '' : 's'} in last ${days}d):\n${lines.join('\n')}`);
        }

        return sections.join('\n\n');
      }

      default:
        return `Error: Unknown health tool "${name}"`;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[health] ${name} failed:`, err);
    return `Error executing ${name}: ${message}`;
  }
}
