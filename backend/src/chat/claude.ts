import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages.js';
import { config } from '../config.js';
import type { MessageRow } from './db.js';

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

export function buildSystemPrompt(params: {
  assistantName: string;
  userName: string;
}): string {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return `You are ${params.assistantName}, a personal AI assistant for ${params.userName}.
Today is ${today}.
Be helpful, concise, and warm.`;
}

export function buildMessages(history: MessageRow[]): MessageParam[] {
  return history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .filter((m) => m.content)
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content!,
    }));
}

export function createStream(params: {
  messages: MessageParam[];
  systemPrompt: string;
}) {
  return client.messages.stream({
    model: 'claude-sonnet-4-5-20250514',
    max_tokens: 8096,
    system: params.systemPrompt,
    messages: params.messages,
  });
}
