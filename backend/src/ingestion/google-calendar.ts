/**
 * Google Calendar API client.
 *
 * Uses existing OAuth credentials from the connectors system. Two modes:
 * - Full sync (first run): fetches events within [now - 1y, now + 1y]
 * - Incremental sync: uses `syncToken` from previous run to fetch only changes
 *
 * Google Calendar incremental sync semantics:
 * - Deleted/cancelled events come back with `status: 'cancelled'`
 * - If the sync token is invalid (expired, ~7 days), Google returns 410 and we
 *   must do a full sync again.
 * - Don't set time bounds (timeMin/timeMax) when using syncToken — Calendar
 *   errors with `400: Only one of ... allowed`.
 */
import { getValidAccessToken } from '../connectors/google-oauth.js';

interface GCalAttendee {
  email?: string;
  displayName?: string;
  responseStatus?: string;
}

export interface GCalEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: GCalAttendee[];
  organizer?: { email?: string; displayName?: string };
  recurringEventId?: string;
}

interface ListEventsParams {
  credentialId: string;
  calendarId?: string;      // defaults to 'primary'
  syncToken?: string;       // if provided, only fetch changes since
  timeMin?: string;         // ISO timestamp (used only when syncToken is absent)
  timeMax?: string;         // ISO timestamp (used only when syncToken is absent)
}

export interface ListEventsPage {
  events: GCalEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

/**
 * Fetch a single page of events. Caller is responsible for paginating with
 * `nextPageToken` until `nextSyncToken` appears (marks end of pagination).
 */
async function fetchPage(
  accessToken: string,
  params: ListEventsParams,
  pageToken?: string,
): Promise<ListEventsPage> {
  const calId = params.calendarId ?? 'primary';
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`);

  if (params.syncToken) {
    url.searchParams.set('syncToken', params.syncToken);
  } else {
    if (params.timeMin) url.searchParams.set('timeMin', params.timeMin);
    if (params.timeMax) url.searchParams.set('timeMax', params.timeMax);
    // Without singleEvents=true, recurring series return as a single item;
    // we want each instance so date queries work.
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
  }

  url.searchParams.set('maxResults', '250');
  url.searchParams.set('showDeleted', 'true');
  if (pageToken) url.searchParams.set('pageToken', pageToken);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 410) {
    // syncToken expired — caller should retry with a full sync.
    throw new Error('SYNC_TOKEN_INVALID');
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google Calendar API error (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = await res.json() as {
    items?: GCalEvent[];
    nextPageToken?: string;
    nextSyncToken?: string;
  };

  return {
    events: data.items ?? [],
    nextPageToken: data.nextPageToken,
    nextSyncToken: data.nextSyncToken,
  };
}

/**
 * Paginate through all events for a calendar. Returns the final `syncToken`
 * to persist for next time.
 *
 * Caller typically does this in one task run — if there are millions of events
 * this won't scale, but for a personal assistant the volume is bounded.
 */
export async function listAllEvents(params: ListEventsParams): Promise<{
  events: GCalEvent[];
  syncToken?: string;
}> {
  const accessToken = await getValidAccessToken(params.credentialId);

  const allEvents: GCalEvent[] = [];
  let pageToken: string | undefined;
  let syncToken: string | undefined;

  // Safety cap — if we've paginated 20 times (5000 events) something is wrong.
  for (let i = 0; i < 20; i++) {
    const page = await fetchPage(accessToken, params, pageToken);
    allEvents.push(...page.events);

    if (page.nextPageToken) {
      pageToken = page.nextPageToken;
      continue;
    }
    // No nextPageToken means this is the last page; syncToken is present.
    syncToken = page.nextSyncToken;
    break;
  }

  return { events: allEvents, syncToken };
}
