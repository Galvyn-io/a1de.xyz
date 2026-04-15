/**
 * calendar.sync task handler.
 *
 * Input shape:
 *   { connectorId: string, backfill?: boolean }
 *
 * Behavior:
 * - Loads the connector's sync_cursor. If missing or `backfill: true`, does
 *   a full sync over ±1 year. Otherwise does incremental sync.
 * - Upserts every event into the events table by (user_id, source, source_id).
 * - Persists the new sync_cursor on the connector.
 * - If Google returns SYNC_TOKEN_INVALID (410), falls back to full sync.
 *
 * This handler runs synchronously (no external async provider like Skyvern).
 * For a typical user's calendar (<2000 events in ±1y) the full sync completes
 * in a few seconds.
 */
import type { TaskHandler, TaskRow, RunResult } from '../types.js';
import { listAllEvents, type GCalEvent } from '../../ingestion/google-calendar.js';
import {
  upsertEvents,
  getConnectorSyncCursor,
  setConnectorSyncCursor,
  type UpsertEventInput,
} from '../../ingestion/events-db.js';

interface CalendarSyncInput {
  connectorId: string;
  backfill?: boolean;
}

function mapEvent(e: GCalEvent, userId: string, connectorId: string): UpsertEventInput {
  const start = e.start?.dateTime ?? e.start?.date ?? null;
  const end = e.end?.dateTime ?? e.end?.date ?? null;
  return {
    userId,
    connectorId,
    source: 'google_calendar',
    sourceId: e.id,
    title: e.summary ?? null,
    description: e.description ?? null,
    location: e.location ?? null,
    attendees: e.attendees ?? [],
    organizer: e.organizer?.email ?? null,
    startAt: start,
    endAt: end,
    allDay: Boolean(e.start?.date),   // date (no time) = all-day event
    recurringEventId: e.recurringEventId ?? null,
    status: e.status ?? 'confirmed',
    deletedAt: e.status === 'cancelled' ? new Date().toISOString() : null,
    raw: e,
  };
}

export const calendarSyncHandler: TaskHandler = {
  type: 'calendar.sync',
  provider: 'google_calendar',

  async run(task: TaskRow): Promise<RunResult> {
    const input = task.input as unknown as CalendarSyncInput;
    if (!input.connectorId) {
      return { status: 'failed', output: { error: 'connectorId required' } };
    }

    // The connector row has the credential_id we need to fetch tokens.
    // We already have the connectorId; look up the credential_id separately.
    const { createClient } = await import('@supabase/supabase-js');
    const { config } = await import('../../config.js');
    const db = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
    const { data: connector } = await db
      .from('connectors')
      .select('user_id, credential_id')
      .eq('id', input.connectorId)
      .single<{ user_id: string; credential_id: string }>();
    if (!connector) {
      return { status: 'failed', output: { error: 'connector not found' } };
    }

    const cursor = input.backfill ? null : await getConnectorSyncCursor(input.connectorId);

    // Build the sync call: incremental if we have a cursor, else full ±1y
    const now = new Date();
    const oneYear = 365 * 24 * 60 * 60 * 1000;

    async function sync(useCursor: string | null) {
      return listAllEvents({
        credentialId: connector!.credential_id,
        ...(useCursor
          ? { syncToken: useCursor }
          : {
              timeMin: new Date(now.getTime() - oneYear).toISOString(),
              timeMax: new Date(now.getTime() + oneYear).toISOString(),
            }),
      });
    }

    let result;
    try {
      result = await sync(cursor);
    } catch (err) {
      // Expired syncToken → fall back to full sync
      if (err instanceof Error && err.message === 'SYNC_TOKEN_INVALID') {
        result = await sync(null);
      } else {
        throw err;
      }
    }

    const mapped = result.events.map((e) => mapEvent(e, connector!.user_id, input.connectorId));
    const { count } = await upsertEvents(mapped);

    if (result.syncToken) {
      await setConnectorSyncCursor(input.connectorId, result.syncToken);
    }

    return {
      status: 'completed',
      output: {
        events_synced: count,
        was_backfill: !cursor,
      },
    };
  },
};
