/**
 * Gmail API client.
 *
 * We never store raw email bodies. We pull just enough metadata (headers +
 * snippet) to classify and extract, then discard. The Gmail API endpoint
 * ID stays on any derived row as `source_id` for provenance.
 *
 * Sync modes:
 * - List with a query (e.g. `after:YYYY/MM/DD`) for backfill
 * - History API with a `historyId` for incremental — returns only message
 *   IDs that have changed since last sync
 */
import { getValidAccessToken } from '../connectors/google-oauth.js';

export interface GmailMessageMeta {
  id: string;
  threadId: string;
  snippet: string;
  from: string;
  to: string;
  subject: string;
  date: string;           // RFC 2822 header value
  internalDate: string;   // milliseconds since epoch
  labelIds: string[];
}

/** List message IDs matching a Gmail search query. Paginated. */
export async function listMessageIds(params: {
  credentialId: string;
  query: string;           // Gmail search syntax: "after:2025/04/15 -in:promotions"
  maxResults?: number;     // cap across all pages
}): Promise<string[]> {
  const accessToken = await getValidAccessToken(params.credentialId);
  const cap = params.maxResults ?? 2000;
  const results: string[] = [];
  let pageToken: string | undefined;

  while (results.length < cap) {
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    url.searchParams.set('q', params.query);
    url.searchParams.set('maxResults', '500');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gmail list error (${res.status}): ${body.slice(0, 300)}`);
    }
    const data = await res.json() as {
      messages?: Array<{ id: string; threadId: string }>;
      nextPageToken?: string;
    };

    for (const m of data.messages ?? []) results.push(m.id);

    if (!data.nextPageToken || results.length >= cap) break;
    pageToken = data.nextPageToken;
  }

  return results.slice(0, cap);
}

/**
 * Fetch a single message's metadata + snippet. Uses `format=metadata` to avoid
 * downloading the full body — much faster and Gmail charges quota by bytes.
 */
export async function fetchMessageMeta(params: {
  credentialId: string;
  messageId: string;
}): Promise<GmailMessageMeta | null> {
  const accessToken = await getValidAccessToken(params.credentialId);
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${params.messageId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail fetch error (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = await res.json() as {
    id: string;
    threadId: string;
    snippet?: string;
    internalDate?: string;
    labelIds?: string[];
    payload?: { headers?: Array<{ name: string; value: string }> };
  };

  const headers = new Map<string, string>();
  for (const h of data.payload?.headers ?? []) {
    headers.set(h.name.toLowerCase(), h.value);
  }

  return {
    id: data.id,
    threadId: data.threadId,
    snippet: data.snippet ?? '',
    from: headers.get('from') ?? '',
    to: headers.get('to') ?? '',
    subject: headers.get('subject') ?? '',
    date: headers.get('date') ?? '',
    internalDate: data.internalDate ?? '0',
    labelIds: data.labelIds ?? [],
  };
}

/** Batch-fetch metadata for many messages in parallel (bounded). */
export async function fetchMessagesMeta(params: {
  credentialId: string;
  messageIds: string[];
  concurrency?: number;
}): Promise<GmailMessageMeta[]> {
  const concurrency = params.concurrency ?? 10;
  const results: GmailMessageMeta[] = [];
  const ids = [...params.messageIds];

  while (ids.length > 0) {
    const batch = ids.splice(0, concurrency);
    const settled = await Promise.allSettled(
      batch.map((id) => fetchMessageMeta({ credentialId: params.credentialId, messageId: id })),
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) results.push(r.value);
    }
  }
  return results;
}

/**
 * Get the current Gmail historyId — the cursor for incremental sync. Call
 * this at the END of a backfill to anchor the next incremental run.
 */
export async function getCurrentHistoryId(credentialId: string): Promise<string> {
  const accessToken = await getValidAccessToken(credentialId);
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Gmail profile error (${res.status})`);
  const data = await res.json() as { historyId: string };
  return data.historyId;
}

/**
 * Incremental sync: list messages added/changed since `startHistoryId`.
 * Gmail's history is garbage-collected after ~1 week; if Gmail returns 404
 * we fall back to re-doing a recent-window backfill.
 */
export async function listChangedMessageIds(params: {
  credentialId: string;
  startHistoryId: string;
}): Promise<{ messageIds: string[]; nextHistoryId: string }> {
  const accessToken = await getValidAccessToken(params.credentialId);

  const messageIds: string[] = [];
  let pageToken: string | undefined;
  let nextHistoryId = params.startHistoryId;

  while (true) {
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/history');
    url.searchParams.set('startHistoryId', params.startHistoryId);
    url.searchParams.set('historyTypes', 'messageAdded');
    url.searchParams.set('maxResults', '500');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 404) {
      throw new Error('HISTORY_EXPIRED');
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gmail history error (${res.status}): ${body.slice(0, 300)}`);
    }

    const data = await res.json() as {
      history?: Array<{
        messagesAdded?: Array<{ message: { id: string; threadId: string } }>;
      }>;
      historyId?: string;
      nextPageToken?: string;
    };

    for (const h of data.history ?? []) {
      for (const ma of h.messagesAdded ?? []) {
        messageIds.push(ma.message.id);
      }
    }
    if (data.historyId) nextHistoryId = data.historyId;

    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  return { messageIds, nextHistoryId };
}

/**
 * Find all thread IDs the user has replied in within the last N days.
 * Used during backfill to pull every message in those threads (including
 * older ones) since replies indicate the user cares about the thread.
 */
export async function listUserReplyThreadIds(params: {
  credentialId: string;
  afterDate: string; // "YYYY/MM/DD" Gmail format
}): Promise<string[]> {
  const accessToken = await getValidAccessToken(params.credentialId);

  // Gmail query for messages the user sent
  const query = `in:sent after:${params.afterDate}`;
  const ids = await listMessageIds({ credentialId: params.credentialId, query, maxResults: 500 });

  // Fetch metadata to get threadIds — batched for efficiency
  const metas = await fetchMessagesMeta({ credentialId: params.credentialId, messageIds: ids });
  return Array.from(new Set(metas.map((m) => m.threadId)));
  // Note: we use threadIds to then query `in:thread:<id>` later if needed, or
  // the caller can add all messages from these threads to their list separately.
  // For now we just expose the thread IDs; email-sync.ts decides how to use them.
}
