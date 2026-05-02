/**
 * Stateless server-to-client realtime broadcasts.
 *
 * The Supabase Realtime client requires a WebSocket subscribe handshake
 * before you can `channel.send(...)`. That handshake costs 0.5–2s on
 * Cloud Run cold-starts (DNS + TLS + Phoenix join), which we pay before
 * the first chat token reaches the user.
 *
 * The REST broadcast endpoint is stateless — one HTTP POST per batch,
 * no socket lifecycle to manage. Subscribers (browsers) receive the
 * messages over their existing WebSocket regardless of how they were
 * sent. Net win: chat feels snappy again.
 *
 * Reference: https://supabase.com/docs/guides/realtime/broadcast#using-the-rest-api
 */
import { config } from './config.js';

interface BroadcastMessage {
  topic: string;
  event: string;
  payload: Record<string, unknown>;
}

/**
 * Send one or more broadcasts to Supabase Realtime via the REST API.
 *
 * Fire-and-forget: callers don't await this in the hot path of the
 * agent loop. Failures are logged, not thrown — losing a token broadcast
 * is a degraded UX, not a correctness bug (the final message lands in
 * `messages` either way).
 */
export async function broadcastFromServer(messages: BroadcastMessage[]): Promise<void> {
  if (messages.length === 0) return;
  try {
    const res = await fetch(`${config.SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        apikey: config.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: messages.map((m) => ({ ...m, private: false })),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[realtime] broadcast HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
  } catch (err) {
    console.warn('[realtime] broadcast failed:', err);
  }
}

/** Convenience wrapper for a single message — the common case. */
export function broadcast(topic: string, event: string, payload: Record<string, unknown>): Promise<void> {
  return broadcastFromServer([{ topic, event, payload }]);
}
