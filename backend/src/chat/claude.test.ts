import { describe, it, expect } from 'vitest';
import { buildMessages, buildSystemPrompt } from './claude.js';
import type { MessageRow } from './db.js';

function row(partial: Partial<MessageRow>): MessageRow {
  return {
    id: partial.id ?? 'm-' + Math.random().toString(36).slice(2),
    conversation_id: 'c1',
    user_id: 'u1',
    role: partial.role ?? 'user',
    content: partial.content ?? null,
    tool_calls: partial.tool_calls ?? null,
    tool_result: partial.tool_result ?? null,
    model: partial.model ?? null,
    parent_message_id: partial.parent_message_id ?? null,
    created_at: '2026-05-01T00:00:00Z',
  };
}

describe('buildMessages', () => {
  it('passes plain user/assistant turns through verbatim', () => {
    const result = buildMessages([
      row({ role: 'user', content: 'hello' }),
      row({ role: 'assistant', content: 'hi there' }),
      row({ role: 'user', content: 'how are you?' }),
    ]);
    expect(result).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
      { role: 'user', content: 'how are you?' },
    ]);
  });

  it('reconstructs assistant tool-use blocks from tool_calls', () => {
    const toolCalls = [
      { type: 'tool_use' as const, id: 'tu_1', name: 'search_memory', input: { query: 'sushi' } },
    ];
    const result = buildMessages([
      row({ role: 'user', content: 'what food do I like?' }),
      row({ role: 'assistant', content: 'Let me check.', tool_calls: toolCalls, id: 'a1' }),
      row({
        role: 'tool',
        content: 'Found: sushi',
        tool_result: { tool_use_id: 'tu_1', content: 'Found: sushi' },
        parent_message_id: 'a1',
      }),
    ]);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ role: 'user', content: 'what food do I like?' });
    expect(result[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me check.' },
        { type: 'tool_use', id: 'tu_1', name: 'search_memory', input: { query: 'sushi' } },
      ],
    });
    expect(result[2]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'Found: sushi' }],
    });
  });

  it('groups multiple parallel tool results into a single user message', () => {
    const toolCalls = [
      { type: 'tool_use' as const, id: 'tu_1', name: 'a', input: {} },
      { type: 'tool_use' as const, id: 'tu_2', name: 'b', input: {} },
    ];
    const result = buildMessages([
      row({ role: 'user', content: 'do two things' }),
      row({ role: 'assistant', tool_calls: toolCalls, id: 'a1' }),
      row({
        role: 'tool',
        tool_result: { tool_use_id: 'tu_1', content: 'first result' },
        parent_message_id: 'a1',
      }),
      row({
        role: 'tool',
        tool_result: { tool_use_id: 'tu_2', content: 'second result' },
        parent_message_id: 'a1',
      }),
    ]);
    // Expect ONE user message containing BOTH tool_result blocks
    const lastMsg = result[result.length - 1];
    expect(lastMsg?.role).toBe('user');
    expect(Array.isArray(lastMsg?.content)).toBe(true);
    const blocks = lastMsg!.content as Array<{ type: string; tool_use_id: string }>;
    expect(blocks).toHaveLength(2);
    expect(blocks[0].tool_use_id).toBe('tu_1');
    expect(blocks[1].tool_use_id).toBe('tu_2');
  });

  it('omits assistant messages with neither content nor tool_calls', () => {
    const result = buildMessages([
      row({ role: 'user', content: 'hi' }),
      row({ role: 'assistant', content: null, tool_calls: null }),
    ]);
    expect(result).toEqual([{ role: 'user', content: 'hi' }]);
  });
});

describe('buildSystemPrompt', () => {
  it('includes assistant + user names and the date', () => {
    const prompt = buildSystemPrompt({ assistantName: 'Test', userName: 'yatharth' });
    expect(prompt).toContain('Test');
    expect(prompt).toContain('yatharth');
    expect(prompt).toContain('Today is');
  });

  it('appends a "What you know" section when always-inject memories are present', () => {
    const prompt = buildSystemPrompt({
      assistantName: 'A1DE',
      userName: 'yatharth',
      alwaysInjectMemories: ['Likes sushi', 'Plays golf on weekends'],
    });
    expect(prompt).toContain('## What you know about yatharth');
    expect(prompt).toContain('- Likes sushi');
    expect(prompt).toContain('- Plays golf on weekends');
  });

  it('omits the section when no memories are passed', () => {
    const prompt = buildSystemPrompt({ assistantName: 'A1DE', userName: 'yatharth' });
    expect(prompt).not.toContain('## What you know about');
  });
});
