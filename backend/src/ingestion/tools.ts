/**
 * Ingestion tools exposed to Claude — read-only queries over the structured
 * data we ingest from connectors.
 *
 * These don't do extraction or semantic search. For "what do I know about X"
 * queries use search_memory. For "what's on my calendar tomorrow" use these.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { listEvents } from './events-db.js';

export const INGESTION_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_calendar_events',
    description:
      "Read the user's calendar events from their synced Google Calendar. " +
      'Returns events within a date range. Use for "what\'s on my calendar", "what meetings do I have tomorrow", "am I free Friday afternoon", etc. ' +
      'This is FAST (structured query, not browser automation) — prefer this over any other method for calendar questions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        from: {
          type: 'string',
          description: 'ISO date/datetime start of the range (e.g. "2026-04-15" or "2026-04-15T00:00:00Z"). Defaults to now.',
        },
        to: {
          type: 'string',
          description: 'ISO date/datetime end of the range. Defaults to 7 days from `from`.',
        },
        query: {
          type: 'string',
          description: 'Optional: keyword to filter events by (title/description/location). Case-insensitive substring match.',
        },
        limit: {
          type: 'number',
          description: 'Max events to return (default 50)',
        },
      },
      required: [],
    },
  },
];

interface GetCalendarEventsInput {
  from?: string;
  to?: string;
  query?: string;
  limit?: number;
}

export async function executeIngestionTool(
  name: string,
  input: unknown,
  userId: string,
): Promise<string> {
  try {
    switch (name) {
      case 'get_calendar_events': {
        const params = input as GetCalendarEventsInput;
        const fromDate = params.from ? new Date(params.from) : new Date();
        const toDate = params.to
          ? new Date(params.to)
          : new Date(fromDate.getTime() + 7 * 24 * 60 * 60 * 1000);

        const events = await listEvents({
          userId,
          from: fromDate,
          to: toDate,
          limit: params.limit ?? 50,
        });

        // Optional keyword filter (done in memory — events lists are small enough)
        const filtered = params.query
          ? events.filter((e) => {
              const q = params.query!.toLowerCase();
              return (
                (e.title?.toLowerCase().includes(q)) ||
                (e.description?.toLowerCase().includes(q)) ||
                (e.location?.toLowerCase().includes(q))
              );
            })
          : events;

        if (filtered.length === 0) {
          return `No calendar events between ${fromDate.toISOString().slice(0, 10)} and ${toDate.toISOString().slice(0, 10)}${params.query ? ` matching "${params.query}"` : ''}.`;
        }

        const lines = filtered.map((e) => {
          const when = e.all_day
            ? new Date(e.start_at!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' (all day)'
            : `${new Date(e.start_at!).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
          const attendees = Array.isArray(e.attendees) ? (e.attendees as Array<{ email?: string }>) : [];
          const attendeeSummary = attendees.length > 0 ? ` · ${attendees.length} attendee${attendees.length === 1 ? '' : 's'}` : '';
          return `- ${when} — ${e.title ?? '(no title)'}${e.location ? ` @ ${e.location}` : ''}${attendeeSummary}`;
        });

        return `${filtered.length} event${filtered.length === 1 ? '' : 's'} found:\n${lines.join('\n')}`;
      }

      default:
        return `Error: Unknown ingestion tool "${name}"`;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[ingestion] ${name} failed:`, err);
    return `Error executing ${name}: ${message}`;
  }
}
