/**
 * Database helpers for the events table.
 *
 * Events are structured (date/title/attendees) — NOT vectorized. Retrieval is
 * by date range + optional keyword, not by semantic similarity. Claude tools
 * read from here via get_calendar_events.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

function getServiceClient() {
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
}

export interface EventRow {
  id: string;
  user_id: string;
  connector_id: string | null;
  source: string;
  source_id: string;
  title: string | null;
  description: string | null;
  location: string | null;
  attendees: unknown;
  organizer: string | null;
  start_at: string | null;
  end_at: string | null;
  all_day: boolean;
  recurring_event_id: string | null;
  status: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertEventInput {
  userId: string;
  connectorId?: string;
  source: string;
  sourceId: string;
  title?: string | null;
  description?: string | null;
  location?: string | null;
  attendees?: unknown;
  organizer?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  allDay?: boolean;
  recurringEventId?: string | null;
  status?: string;
  deletedAt?: string | null;
  raw?: unknown;
}

/**
 * Upsert by (user_id, source, source_id). Re-running a sync is safe.
 */
export async function upsertEvents(events: UpsertEventInput[]): Promise<{ count: number }> {
  if (events.length === 0) return { count: 0 };
  const db = getServiceClient();

  const rows = events.map((e) => ({
    user_id: e.userId,
    connector_id: e.connectorId ?? null,
    source: e.source,
    source_id: e.sourceId,
    title: e.title ?? null,
    description: e.description ?? null,
    location: e.location ?? null,
    attendees: e.attendees ?? [],
    organizer: e.organizer ?? null,
    start_at: e.startAt ?? null,
    end_at: e.endAt ?? null,
    all_day: e.allDay ?? false,
    recurring_event_id: e.recurringEventId ?? null,
    status: e.status ?? 'confirmed',
    deleted_at: e.deletedAt ?? null,
    raw: e.raw ?? null,
  }));

  // supabase-js has upsert — we use (user_id, source, source_id) unique index.
  const { error, count } = await db
    .from('events')
    .upsert(rows, { onConflict: 'user_id,source,source_id', count: 'exact' });
  if (error) throw error;
  return { count: count ?? rows.length };
}

export async function listEvents(params: {
  userId: string;
  from?: Date;
  to?: Date;
  limit?: number;
}): Promise<EventRow[]> {
  const db = getServiceClient();
  let q = db
    .from('events')
    .select('*')
    .eq('user_id', params.userId)
    .neq('status', 'cancelled')
    .is('deleted_at', null)
    .order('start_at', { ascending: true });

  if (params.from) q = q.gte('start_at', params.from.toISOString());
  if (params.to) q = q.lte('start_at', params.to.toISOString());
  if (params.limit) q = q.limit(params.limit);

  const { data, error } = await q.returns<EventRow[]>();
  if (error) throw error;
  return data ?? [];
}

/**
 * Get the per-connector sync cursor (syncToken for Google Calendar,
 * historyId for Gmail, etc.).
 */
export async function getConnectorSyncCursor(connectorId: string): Promise<string | null> {
  const db = getServiceClient();
  const { data } = await db
    .from('connectors')
    .select('sync_cursor')
    .eq('id', connectorId)
    .single<{ sync_cursor: string | null }>();
  return data?.sync_cursor ?? null;
}

export async function setConnectorSyncCursor(connectorId: string, cursor: string): Promise<void> {
  const db = getServiceClient();
  const { error } = await db
    .from('connectors')
    .update({ sync_cursor: cursor, last_synced_at: new Date().toISOString() })
    .eq('id', connectorId);
  if (error) throw error;
}

/**
 * Find the primary google_calendar connector for a user. Returns null if none
 * exists or the connector is disabled.
 */
export async function getActiveCalendarConnector(userId: string): Promise<{
  id: string;
  credential_id: string;
} | null> {
  const db = getServiceClient();
  const { data } = await db
    .from('connectors')
    .select('id, credential_id')
    .eq('user_id', userId)
    .eq('provider', 'google_calendar')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle<{ id: string; credential_id: string }>();
  return data ?? null;
}

/**
 * Find all users with an active calendar connector. Used by the hourly tick
 * to decide who needs a sync task.
 */
export async function listUsersWithCalendarConnector(): Promise<Array<{
  user_id: string;
  id: string;
  credential_id: string;
}>> {
  const db = getServiceClient();
  const { data, error } = await db
    .from('connectors')
    .select('id, user_id, credential_id')
    .eq('provider', 'google_calendar')
    .eq('status', 'active')
    .returns<Array<{ id: string; user_id: string; credential_id: string }>>();
  if (error) throw error;
  return data ?? [];
}
