import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./config.js', () => ({
  config: {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'secret-key',
  },
}));

const fetchMock = vi.fn();
(globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

import { broadcast, broadcastFromServer } from './realtime.js';

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
});

describe('broadcast (single)', () => {
  it('POSTs to the realtime broadcast endpoint with the right body shape', async () => {
    await broadcast('chat:abc', 'delta', { text: 'hi' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.supabase.co/realtime/v1/api/broadcast');
    expect(init.method).toBe('POST');
    expect(init.headers.apikey).toBe('secret-key');
    expect(init.headers.Authorization).toBe('Bearer secret-key');
    const body = JSON.parse(init.body as string);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toEqual({
      topic: 'chat:abc',
      event: 'delta',
      payload: { text: 'hi' },
      private: false,
    });
  });

  it('swallows fetch failures so the agent loop never wedges on realtime', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await expect(broadcast('chat:abc', 'delta', { text: 'hi' })).resolves.toBeUndefined();
  });

  it('logs a warning on non-2xx but does not throw', async () => {
    fetchMock.mockResolvedValueOnce(new Response('rate limited', { status: 429 }));
    await expect(broadcast('chat:abc', 'delta', { text: 'hi' })).resolves.toBeUndefined();
  });
});

describe('broadcastFromServer (batch)', () => {
  it('does not call fetch when given an empty batch', async () => {
    await broadcastFromServer([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends multiple messages in one POST', async () => {
    await broadcastFromServer([
      { topic: 'chat:a', event: 'delta', payload: { text: 'one' } },
      { topic: 'chat:a', event: 'done', payload: { message_id: 'm1' } },
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.messages).toHaveLength(2);
  });
});
