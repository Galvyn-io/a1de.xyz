import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages.js';
import { config } from '../config.js';
import type { MessageRow } from './db.js';

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

export function buildSystemPrompt(params: {
  assistantName: string;
  userName: string;
  alwaysInjectMemories?: string[];
}): string {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  let prompt = `You are ${params.assistantName}, a personal AI assistant for ${params.userName}.
Today is ${today}.
Be helpful, concise, and warm.

When the user tells you something about themselves (preferences, habits, relationships, important facts), use the save_fact tool to remember it.
When the user asks about something that might be in your memory (people, projects, preferences, past events), use the search_memory tool to look it up.`;

  if (params.alwaysInjectMemories?.length) {
    prompt += `\n\n## What you know about ${params.userName}\n`;
    prompt += params.alwaysInjectMemories.map((m) => `- ${m}`).join('\n');
  }

  return prompt;
}

export function buildMessages(history: MessageRow[]): MessageParam[] {
  const result: MessageParam[] = [];

  for (const msg of history) {
    if (msg.role === 'user' && msg.content) {
      result.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant') {
      if (msg.tool_calls) {
        // Assistant message with tool use — reconstruct content blocks
        // Use the raw tool_calls JSONB as stored (already in correct Anthropic format)
        const blocks: unknown[] = [];
        if (msg.content) {
          blocks.push({ type: 'text', text: msg.content });
        }
        const toolCalls = msg.tool_calls as Array<{ type: 'tool_use'; id: string; name: string; input: unknown }>;
        for (const tc of toolCalls) {
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
        }
        result.push({ role: 'assistant', content: blocks as MessageParam['content'] });
      } else if (msg.content) {
        result.push({ role: 'assistant', content: msg.content });
      }
    } else if (msg.role === 'tool' && msg.tool_result) {
      // Tool result — Anthropic API expects this as a user message with tool_result blocks
      const toolResult = msg.tool_result as { tool_use_id: string; content: string };

      // Check if last message is already a user tool_result message (multiple tool results)
      const lastMsg = result[result.length - 1];
      if (lastMsg?.role === 'user' && Array.isArray(lastMsg.content) &&
          (lastMsg.content as Array<{ type: string }>)[0]?.type === 'tool_result') {
        (lastMsg.content as Array<unknown>).push({
          type: 'tool_result',
          tool_use_id: toolResult.tool_use_id,
          content: toolResult.content,
        });
      } else {
        result.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolResult.tool_use_id,
              content: toolResult.content,
            },
          ],
        });
      }
    }
  }

  return result;
}

export function callClaude(params: {
  messages: MessageParam[];
  systemPrompt: string;
  tools?: Anthropic.Tool[];
}) {
  return client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 8096,
    system: params.systemPrompt,
    messages: params.messages,
    tools: params.tools,
  });
}

export function streamClaude(params: {
  messages: MessageParam[];
  systemPrompt: string;
}) {
  return client.messages.stream({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 8096,
    system: params.systemPrompt,
    messages: params.messages,
  });
}
