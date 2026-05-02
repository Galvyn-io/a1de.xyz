/**
 * Tests for the chat.respond task handler.
 *
 * Strategy: stub every external dependency at the module boundary with vi.mock,
 * then drive different stop_reason / tool_use scenarios through a fake
 * Anthropic stream. We assert on what gets persisted via `addMessage`.
 *
 * Why mock at module level instead of dependency injection? Keeping the
 * handler free of test-only seams keeps the production code simple. The
 * mocks here document the dependency surface the handler relies on.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { TaskRow } from '../types.js';

// ---- Module mocks ---------------------------------------------------------

const mockAddMessage = vi.fn();
const mockGetConversation = vi.fn();
const mockGetMessages = vi.fn();
const mockTouchConversation = vi.fn();

vi.mock('../../chat/db.js', () => ({
  addMessage: (...args: unknown[]) => mockAddMessage(...args),
  getConversation: (...args: unknown[]) => mockGetConversation(...args),
  getMessages: (...args: unknown[]) => mockGetMessages(...args),
  touchConversation: (...args: unknown[]) => mockTouchConversation(...args),
}));

const mockGetAlwaysInjectMemories = vi.fn();
vi.mock('../../memory/db.js', () => ({
  getAlwaysInjectMemories: (...args: unknown[]) => mockGetAlwaysInjectMemories(...args),
}));

vi.mock('../../memory/tools.js', () => ({
  MEMORY_TOOLS: [],
  executeTool: vi.fn(async (_name: string, _input: unknown, _userId: string) => 'memory result'),
}));

vi.mock('../../golf/tools.js', () => ({
  GOLF_TOOLS: [],
  executeGolfTool: vi.fn(async () => 'golf result'),
}));

vi.mock('../../ingestion/tools.js', () => ({
  INGESTION_TOOLS: [],
  executeIngestionTool: vi.fn(async () => 'ingestion result'),
}));

const mockCreateTask = vi.fn();
vi.mock('../runner.js', () => ({
  createTask: (...args: unknown[]) => mockCreateTask(...args),
}));

vi.mock('../../telemetry.js', () => {
  const gen = { end: vi.fn() };
  const trace = {
    generation: vi.fn(() => gen),
    update: vi.fn(),
  };
  return {
    langfuse: {
      trace: vi.fn(() => trace),
      flushAsync: vi.fn(async () => undefined),
    },
  };
});

// Anthropic stream — drive a scripted sequence of text deltas + a finalMessage.
type ScriptedFinal = {
  model: string;
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens';
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  >;
  usage: { input_tokens: number; output_tokens: number };
};

let scriptedResponses: ScriptedFinal[] = [];
let streamCallCount = 0;
const textListeners: Array<(delta: string, snapshot: string) => void> = [];

function makeFakeStream(textDeltas: string[], final: ScriptedFinal) {
  return {
    on(event: string, listener: (delta: string, snapshot: string) => void) {
      if (event === 'text') {
        textListeners.push(listener);
        // Fire deltas synchronously so the test doesn't have to wait
        let snapshot = '';
        for (const d of textDeltas) {
          snapshot += d;
          listener(d, snapshot);
        }
      }
      return this;
    },
    off() {
      return this;
    },
    async finalMessage() {
      return final;
    },
  };
}

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class FakeAnthropic {
      messages = {
        stream: vi.fn(() => {
          const final = scriptedResponses[streamCallCount];
          streamCallCount++;
          // Derive text deltas from the final response's text blocks for simplicity.
          const text = final.content
            .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
            .map((b) => b.text)
            .join('');
          // Split into ~3 char chunks so multiple delta events fire.
          const chunks: string[] = [];
          for (let i = 0; i < text.length; i += 3) chunks.push(text.slice(i, i + 3));
          return makeFakeStream(chunks, final);
        }),
      };
    },
  };
});

// Realtime broadcasts go through backend/src/realtime.ts (fetch-based).
// We capture them at the module boundary instead of mocking global fetch
// so the test stays focused on the handler's behavior.
const broadcastSends: Array<{ event: string; payload: Record<string, unknown> }> = [];
let broadcastShouldFail = false;

vi.mock('../../realtime.js', () => ({
  broadcast: vi.fn(async (_topic: string, event: string, payload: Record<string, unknown>) => {
    if (broadcastShouldFail) return; // simulate degraded realtime
    broadcastSends.push({ event, payload });
  }),
  broadcastFromServer: vi.fn(),
}));

// Supabase: createClient returns a stub with `.from(...)` for the user_profiles
// query. The handler no longer uses .channel() — broadcasts happen via REST.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { assistant_name: 'Test', email: 'test@example.com' } }),
        }),
      }),
    }),
  }),
}));

// Config — minimal stub so handler imports succeed.
vi.mock('../../config.js', () => ({
  config: {
    SUPABASE_URL: 'http://test',
    SUPABASE_SERVICE_ROLE_KEY: 'test',
    ANTHROPIC_API_KEY: 'test',
    LANGFUSE_PUBLIC_KEY: 'test',
    LANGFUSE_SECRET_KEY: 'test',
    LANGFUSE_BASE_URL: 'http://test',
  },
}));

// ---- Test setup -----------------------------------------------------------

import { chatRespondHandler } from './chat-respond.js';

function makeTask(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 'task-1',
    user_id: 'user-1',
    type: 'chat.respond',
    status: 'running',
    input: { conversationId: 'conv-1' },
    output: null,
    error: null,
    external_provider: null,
    external_id: null,
    progress_message: null,
    progress_pct: null,
    conversation_id: 'conv-1',
    schedule_id: null,
    parent_task_id: null,
    scheduled_for: null,
    started_at: null,
    completed_at: null,
    retry_count: 0,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  scriptedResponses = [];
  streamCallCount = 0;
  textListeners.length = 0;
  broadcastSends.length = 0;
  broadcastShouldFail = false;
  vi.clearAllMocks();

  mockGetConversation.mockResolvedValue({
    id: 'conv-1',
    user_id: 'user-1',
    title: null,
    created_at: '2026-05-01',
    updated_at: '2026-05-01',
  });
  mockGetMessages.mockResolvedValue([
    {
      id: 'm-user-1',
      conversation_id: 'conv-1',
      user_id: 'user-1',
      role: 'user',
      content: 'hello',
      tool_calls: null,
      tool_result: null,
      model: null,
      parent_message_id: null,
      created_at: '2026-05-01',
    },
  ]);
  mockGetAlwaysInjectMemories.mockResolvedValue([]);
  mockAddMessage.mockImplementation(async (params) => ({
    id: 'saved-' + Math.random().toString(36).slice(2, 8),
    ...params,
    created_at: '2026-05-01',
  }));
  mockTouchConversation.mockResolvedValue(undefined);
  mockCreateTask.mockResolvedValue({ id: 'mem-task-1' });
});

// ---- Tests ----------------------------------------------------------------

describe('chat.respond handler', () => {
  it('persists the final assistant message on a single end_turn turn', async () => {
    scriptedResponses = [
      {
        model: 'claude-sonnet-4-5-20250929',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Hi! Sushi is your favorite.' }],
        usage: { input_tokens: 10, output_tokens: 8 },
      },
    ];

    const result = await chatRespondHandler.run(makeTask());
    expect(result.status).toBe('completed');

    // Final assistant message saved with the full text
    const finalSave = mockAddMessage.mock.calls.find(
      (call) => call[0].role === 'assistant' && !call[0].toolCalls,
    );
    expect(finalSave).toBeDefined();
    expect(finalSave![0].content).toBe('Hi! Sushi is your favorite.');

    // memory.extract task scheduled
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'memory.extract' }),
    );

    // delta + done broadcasts fired
    expect(broadcastSends.some((b) => b.event === 'delta')).toBe(true);
    expect(broadcastSends.some((b) => b.event === 'done')).toBe(true);
  });

  it('runs a tool_use turn followed by an end_turn turn', async () => {
    scriptedResponses = [
      {
        model: 'claude-sonnet-4-5-20250929',
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Let me check.' },
          { type: 'tool_use', id: 'tu_1', name: 'search_memory', input: { query: 'food' } },
        ],
        usage: { input_tokens: 5, output_tokens: 5 },
      },
      {
        model: 'claude-sonnet-4-5-20250929',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'You like sushi.' }],
        usage: { input_tokens: 12, output_tokens: 5 },
      },
    ];

    const result = await chatRespondHandler.run(makeTask());
    expect(result.status).toBe('completed');

    // Three addMessage calls: assistant-with-tool_calls, tool result, final assistant
    const calls = mockAddMessage.mock.calls.map((c) => c[0]);
    const assistantToolCallSave = calls.find((c) => c.role === 'assistant' && c.toolCalls);
    const toolResultSave = calls.find((c) => c.role === 'tool');
    const finalSave = calls.find((c) => c.role === 'assistant' && !c.toolCalls);

    expect(assistantToolCallSave).toBeDefined();
    expect(toolResultSave).toBeDefined();
    expect(toolResultSave!.toolResult).toMatchObject({ tool_use_id: 'tu_1' });
    expect(finalSave!.content).toBe('You like sushi.');

    // tool_call broadcast fired
    expect(broadcastSends.some((b) => b.event === 'tool_call' && b.payload.name === 'search_memory')).toBe(
      true,
    );
  });

  it('persists the final message even when realtime broadcast fails (disconnect-resilience)', async () => {
    broadcastShouldFail = true;
    scriptedResponses = [
      {
        model: 'claude-sonnet-4-5-20250929',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'reply with no realtime' }],
        usage: { input_tokens: 1, output_tokens: 5 },
      },
    ];

    const result = await chatRespondHandler.run(makeTask());
    expect(result.status).toBe('completed');

    // Final message saved despite the realtime broadcast failing
    const finalSave = mockAddMessage.mock.calls.find(
      (call) => call[0].role === 'assistant' && !call[0].toolCalls,
    );
    expect(finalSave).toBeDefined();
    expect(finalSave![0].content).toBe('reply with no realtime');

    // No broadcasts should have been recorded since the mock simulated failure
    expect(broadcastSends).toHaveLength(0);
  });

  it('caps the tool-use loop at MAX_TOOL_ITERATIONS', async () => {
    // 6 tool_use turns; the handler should bail after 5
    const toolTurn: ScriptedFinal = {
      model: 'claude-sonnet-4-5-20250929',
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu', name: 'search_memory', input: {} }],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    scriptedResponses = [toolTurn, toolTurn, toolTurn, toolTurn, toolTurn, toolTurn];

    const result = await chatRespondHandler.run(makeTask());
    expect(result.status).toBe('completed');
    // Only 5 stream() calls — loop bailed before the 6th.
    expect(streamCallCount).toBe(5);
  });

  it('fails gracefully when conversation_id is missing', async () => {
    const result = await chatRespondHandler.run(
      makeTask({ input: {}, conversation_id: null }),
    );
    expect(result.status).toBe('failed');
    expect(String(result.output?.error)).toContain('conversationId');
  });
});
