/**
 * Whoop webhook handler.
 *
 * Whoop POSTs an event when a recovery / sleep / cycle / workout score
 * publishes. We verify the signature, look up the connector by the Whoop
 * user_id (stored as `account_id` on connector_credentials), and schedule
 * a `whoop.sync` task to pull the new data.
 *
 * Dedupe: a burst of events for the same user (e.g. recovery + sleep
 * publishing within seconds) would otherwise spawn N sync tasks. We
 * skip task creation if a `whoop.sync` task was created in the last
 * `WEBHOOK_DEDUPE_WINDOW_MS` for this connector.
 *
 * Signature scheme (per Whoop docs):
 *   X-WHOOP-Signature: base64(HMAC_SHA256(client_secret, timestamp + body))
 *   X-WHOOP-Signature-Timestamp: unix milliseconds
 *
 * We require the timestamp to be within 5 minutes of "now" to prevent replay.
 */
import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { createTask } from '../tasks/index.js';

const WEBHOOK_DEDUPE_WINDOW_MS = 60 * 1000;
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

const whoop = new Hono();

interface WhoopWebhookPayload {
  user_id: number;
  id?: string | number;
  trace_id?: string;
  type:
    | 'recovery.updated'
    | 'sleep.updated'
    | 'cycle.updated'
    | 'workout.updated'
    | 'body_measurement.updated'
    | string;
}

function verifySignature(params: {
  secret: string;
  timestamp: string;
  rawBody: string;
  signature: string;
}): boolean {
  const computed = createHmac('sha256', params.secret)
    .update(params.timestamp + params.rawBody)
    .digest('base64');

  const a = Buffer.from(computed);
  const b = Buffer.from(params.signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

whoop.post('/', async (c) => {
  // Whoop is silent if creds aren't configured — the webhook URL just
  // wouldn't work, which is the right failure mode.
  if (!config.WHOOP_CLIENT_SECRET) {
    return c.json({ error: 'whoop not configured' }, 503);
  }

  const signature = c.req.header('x-whoop-signature') ?? c.req.header('X-WHOOP-Signature');
  const timestamp =
    c.req.header('x-whoop-signature-timestamp') ?? c.req.header('X-WHOOP-Signature-Timestamp');
  if (!signature || !timestamp) {
    return c.json({ error: 'missing signature headers' }, 401);
  }

  // Reject stale timestamps to mitigate replay.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > TIMESTAMP_TOLERANCE_MS) {
    return c.json({ error: 'timestamp out of window' }, 401);
  }

  const rawBody = await c.req.text();

  if (
    !verifySignature({
      secret: config.WHOOP_CLIENT_SECRET,
      timestamp,
      rawBody,
      signature,
    })
  ) {
    return c.json({ error: 'invalid signature' }, 401);
  }

  let payload: WhoopWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WhoopWebhookPayload;
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }

  if (!payload.user_id) {
    return c.json({ error: 'missing user_id' }, 400);
  }

  // Find the connector this event belongs to. The Whoop user_id was stored
  // as the credential's account_id when the user authorized.
  const db = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
  const { data: credential } = await db
    .from('connector_credentials')
    .select('id, user_id')
    .eq('provider', 'whoop')
    .eq('account_id', String(payload.user_id))
    .single<{ id: string; user_id: string }>();

  if (!credential) {
    // 200 is intentional — Whoop won't retry on 4xx, and we don't want a
    // sender we don't recognize to retry forever. Log and acknowledge.
    console.warn(`[whoop-webhook] no connector for whoop user_id=${payload.user_id}`);
    return c.json({ ok: true, ignored: 'unknown_user' });
  }

  const { data: connector } = await db
    .from('connectors')
    .select('id')
    .eq('credential_id', credential.id)
    .eq('provider', 'whoop')
    .single<{ id: string }>();

  if (!connector) {
    console.warn(`[whoop-webhook] credential ${credential.id} has no connector`);
    return c.json({ ok: true, ignored: 'no_connector' });
  }

  // Dedupe: skip if a recent whoop.sync task already covers this connector.
  const cutoff = new Date(Date.now() - WEBHOOK_DEDUPE_WINDOW_MS).toISOString();
  const { data: recent } = await db
    .from('tasks')
    .select('id')
    .eq('user_id', credential.user_id)
    .eq('type', 'whoop.sync')
    .eq('input->>connectorId', connector.id)
    .gte('created_at', cutoff)
    .in('status', ['pending', 'running'])
    .limit(1);

  if (recent && recent.length > 0) {
    return c.json({ ok: true, deduped: true, event: payload.type });
  }

  await createTask({
    userId: credential.user_id,
    type: 'whoop.sync',
    input: { connectorId: connector.id },
  });

  return c.json({ ok: true, scheduled: true, event: payload.type });
});

export { whoop as whoopWebhook };
