/**
 * Webhook signature + flow tests.
 *
 * Signature verification is security-critical — a bypass would let
 * anyone trigger sync tasks for arbitrary users. These tests pin the
 * expected behavior on bad signature, stale timestamp, missing headers,
 * unknown user, and the dedupe path.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';

// Hoisted by vitest above non-mock code; keep the literal inline so the
// mock factory doesn't reach for an outer binding before it's assigned.
vi.mock('../config.js', () => ({
  config: {
    SUPABASE_URL: 'http://test',
    SUPABASE_SERVICE_ROLE_KEY: 'test',
    WHOOP_CLIENT_SECRET: 'test-whoop-secret',
  },
}));

const SECRET = 'test-whoop-secret';

const mockCreateTask = vi.fn();
vi.mock('../tasks/index.js', () => ({
  createTask: (...args: unknown[]) => mockCreateTask(...args),
}));

// Programmable Supabase stub: each test sets the responses it wants for
// the credential lookup, the connector lookup, and the recent-tasks query.
let credentialResponse: { id: string; user_id: string } | null = null;
let connectorResponse: { id: string } | null = null;
let recentTasks: Array<{ id: string }> = [];

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'connector_credentials') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({ data: credentialResponse }),
              }),
            }),
          }),
        };
      }
      if (table === 'connectors') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({ data: connectorResponse }),
              }),
            }),
          }),
        };
      }
      if (table === 'tasks') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  gte: () => ({
                    in: () => ({
                      limit: async () => ({ data: recentTasks }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

import { whoopWebhook } from './whoop.js';

function sign(timestamp: string, body: string): string {
  return createHmac('sha256', SECRET).update(timestamp + body).digest('base64');
}

async function callWebhook(opts: {
  body: string;
  signature?: string;
  timestamp?: string | null;
}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.signature !== undefined) headers['x-whoop-signature'] = opts.signature;
  if (opts.timestamp !== null && opts.timestamp !== undefined) {
    headers['x-whoop-signature-timestamp'] = opts.timestamp;
  }
  return whoopWebhook.request('/', {
    method: 'POST',
    headers,
    body: opts.body,
  });
}

beforeEach(() => {
  credentialResponse = { id: 'cred-1', user_id: 'user-1' };
  connectorResponse = { id: 'conn-1' };
  recentTasks = [];
  vi.clearAllMocks();
});

describe('POST /webhooks/whoop', () => {
  it('rejects missing signature headers', async () => {
    const body = JSON.stringify({ user_id: 12345, type: 'recovery.updated' });
    const res = await callWebhook({ body, signature: undefined, timestamp: undefined });
    expect(res.status).toBe(401);
  });

  it('rejects stale timestamps (replay protection)', async () => {
    const body = JSON.stringify({ user_id: 12345, type: 'recovery.updated' });
    const stale = String(Date.now() - 10 * 60 * 1000);
    const res = await callWebhook({
      body,
      signature: sign(stale, body),
      timestamp: stale,
    });
    expect(res.status).toBe(401);
  });

  it('rejects an invalid signature', async () => {
    const body = JSON.stringify({ user_id: 12345, type: 'recovery.updated' });
    const ts = String(Date.now());
    const res = await callWebhook({
      body,
      signature: 'wrong',
      timestamp: ts,
    });
    expect(res.status).toBe(401);
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('schedules a sync task for a valid event', async () => {
    const body = JSON.stringify({ user_id: 12345, type: 'recovery.updated' });
    const ts = String(Date.now());
    const res = await callWebhook({
      body,
      signature: sign(ts, body),
      timestamp: ts,
    });
    expect(res.status).toBe(200);
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'whoop.sync', userId: 'user-1' }),
    );
  });

  it('dedupes when a recent whoop.sync task already exists', async () => {
    recentTasks = [{ id: 'task-existing' }];
    const body = JSON.stringify({ user_id: 12345, type: 'sleep.updated' });
    const ts = String(Date.now());
    const res = await callWebhook({
      body,
      signature: sign(ts, body),
      timestamp: ts,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { deduped?: boolean };
    expect(json.deduped).toBe(true);
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('acknowledges (200) but does not schedule when the user is unknown', async () => {
    credentialResponse = null;
    const body = JSON.stringify({ user_id: 99999, type: 'recovery.updated' });
    const ts = String(Date.now());
    const res = await callWebhook({
      body,
      signature: sign(ts, body),
      timestamp: ts,
    });
    expect(res.status).toBe(200);
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON', async () => {
    const body = 'not json';
    const ts = String(Date.now());
    const res = await callWebhook({
      body,
      signature: sign(ts, body),
      timestamp: ts,
    });
    expect(res.status).toBe(400);
  });
});
