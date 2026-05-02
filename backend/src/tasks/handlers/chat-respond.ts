/**
 * chat.respond task handler.
 *
 * Runs the Claude tool-use loop server-side using the streaming API. Live
 * token deltas are broadcast over Supabase realtime (`chat:{conversationId}`)
 * so the UI sees them as they arrive. Tool calls, tool results, and the
 * final assistant message are persisted to the `messages` table; the
 * frontend's postgres_changes subscription picks those up.
 *
 * Broadcasts use the stateless REST endpoint (see backend/src/realtime.ts)
 * rather than the WebSocket-based channel API. The WS approach required a
 * 0.5–2s subscribe handshake before the first send, which the user saw as
 * latency before the first token. REST is one HTTP POST per batch — no
 * socket lifecycle.
 *
 * Why a task and not an HTTP handler:
 *   The agent loop runs to completion regardless of client presence. Close
 *   the tab mid-response — the answer still shows up when you come back,
 *   because the task wrote it to the DB.
 *
 * Input shape (passed via `task.input`):
 *   { conversationId: string }
 *
 * The user's prompt has already been written to `messages` by `POST /chat`
 * before this task runs, so we read it from history, not from input.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ToolUseBlock, TextBlock } from '@anthropic-ai/sdk/resources/messages.js';
import { createClient } from '@supabase/supabase-js';
import type { TaskHandler, TaskRow, RunResult } from '../types.js';
import { config } from '../../config.js';
import { langfuse } from '../../telemetry.js';
import {
  addMessage,
  getConversation,
  getMessages,
  touchConversation,
} from '../../chat/db.js';
import { buildSystemPrompt, buildMessages } from '../../chat/claude.js';
import { getAlwaysInjectMemories } from '../../memory/db.js';
import { MEMORY_TOOLS, executeTool as executeMemoryTool } from '../../memory/tools.js';
import { GOLF_TOOLS, executeGolfTool } from '../../golf/tools.js';
import { INGESTION_TOOLS, executeIngestionTool } from '../../ingestion/tools.js';
import { createTask } from '../runner.js';
import { broadcast as broadcastRealtime } from '../../realtime.js';

const MAX_TOOL_ITERATIONS = 5;
// Batch live token deltas so we don't fire one broadcast per character.
// 80ms is short enough to feel real-time and long enough to coalesce useful chunks.
const DELTA_BATCH_MS = 80;

const WEB_SEARCH_TOOL = {
  type: 'web_search_20250305' as const,
  name: 'web_search',
  max_uses: 5,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ALL_TOOLS: any[] = [...MEMORY_TOOLS, ...GOLF_TOOLS, ...INGESTION_TOOLS, WEB_SEARCH_TOOL];

const GOLF_TOOL_NAMES = new Set(GOLF_TOOLS.map((t) => t.name));
const INGESTION_TOOL_NAMES = new Set(INGESTION_TOOLS.map((t) => t.name));

async function executeTool(
  name: string,
  input: unknown,
  userId: string,
  conversationId?: string,
): Promise<string> {
  if (GOLF_TOOL_NAMES.has(name)) return executeGolfTool(name, input, userId, conversationId);
  if (INGESTION_TOOL_NAMES.has(name)) return executeIngestionTool(name, input, userId);
  return executeMemoryTool(name, input, userId);
}

interface ChatRespondInput {
  conversationId?: string;
}

export const chatRespondHandler: TaskHandler = {
  type: 'chat.respond',
  provider: 'anthropic',

  async run(task: TaskRow): Promise<RunResult> {
    const input = task.input as unknown as ChatRespondInput;
    const conversationId = input.conversationId ?? task.conversation_id;
    if (!conversationId) {
      return { status: 'failed', output: { error: 'conversationId required' } };
    }

    const conversation = await getConversation(conversationId, task.user_id);
    if (!conversation) {
      return { status: 'failed', output: { error: 'Conversation not found' } };
    }

    // Load profile, always-inject memories, and conversation history.
    const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('assistant_name, email')
      .eq('id', task.user_id)
      .single<{ assistant_name: string | null; email: string }>();

    const assistantName = profile?.assistant_name ?? 'A1DE';
    const userName = profile?.email?.split('@')[0] ?? 'there';

    const alwaysInjectMemories = await getAlwaysInjectMemories(task.user_id);
    const history = await getMessages(conversationId, task.user_id);
    const systemPrompt = buildSystemPrompt({ assistantName, userName, alwaysInjectMemories });
    const lastUserMessage = history.filter((m) => m.role === 'user').pop()?.content ?? '';

    // Send live token deltas + tool indicators over Supabase realtime
    // broadcast (REST API — no socket subscribe handshake, so the first
    // token reaches the user as soon as Claude emits it).
    const topic = `chat:${conversationId}`;
    const broadcast = (event: string, payload: Record<string, unknown>): void => {
      // Fire-and-forget. The final message is persisted to `messages` either
      // way; broadcast is purely a UX nicety for the live-typing effect.
      void broadcastRealtime(topic, event, payload);
    };

    const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

    const trace = langfuse.trace({
      name: 'chat',
      userId: task.user_id,
      sessionId: conversationId,
      tags: ['chat'],
      input: lastUserMessage,
    });

    let currentMessages: MessageParam[] = buildMessages(history);
    let finalContent = '';
    let finalModel = '';
    let usedTools = false;

    try {
      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
        const stream = client.messages.stream({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 8096,
          system: systemPrompt,
          messages: currentMessages,
          tools: ALL_TOOLS,
        });

        // Coalesce text deltas into ~80ms windows before broadcasting.
        let textBuffer = '';
        let flushTimer: ReturnType<typeof setTimeout> | null = null;
        const flush = (): void => {
          if (textBuffer) {
            broadcast('delta', { text: textBuffer });
            textBuffer = '';
          }
          flushTimer = null;
        };
        const onText = (delta: string): void => {
          textBuffer += delta;
          if (!flushTimer) flushTimer = setTimeout(flush, DELTA_BATCH_MS);
        };
        stream.on('text', onText);

        let response;
        try {
          response = await stream.finalMessage();
        } finally {
          stream.off('text', onText);
          if (flushTimer) clearTimeout(flushTimer);
          flush();
        }

        finalModel = response.model;

        const gen = trace.generation({
          name: `claude-${iteration}`,
          model: response.model,
          input: { messages: currentMessages },
          output: response.content,
          usage: {
            input: response.usage.input_tokens,
            output: response.usage.output_tokens,
          },
        });
        gen.end();

        if (response.stop_reason === 'end_turn') {
          finalContent = response.content
            .filter((b): b is TextBlock => b.type === 'text')
            .map((b) => b.text)
            .join('');
          break;
        }

        if (response.stop_reason === 'tool_use') {
          usedTools = true;
          const toolUseBlocks = response.content.filter(
            (b): b is ToolUseBlock => b.type === 'tool_use',
          );
          const interimText = response.content
            .filter((b): b is TextBlock => b.type === 'text')
            .map((b) => b.text)
            .join('');

          for (const tb of toolUseBlocks) {
            broadcast('tool_call', { name: tb.name, input: tb.input });
          }

          // Persist the assistant turn that contains the tool calls.
          const assistantMsg = await addMessage({
            conversationId,
            userId: task.user_id,
            role: 'assistant',
            content: interimText || undefined,
            toolCalls: toolUseBlocks,
            model: response.model,
          });

          // Run all tools in parallel; each one's result becomes a tool message.
          const toolResults = await Promise.all(
            toolUseBlocks.map(async (tb) => {
              const result = await executeTool(tb.name, tb.input, task.user_id, conversationId);
              await addMessage({
                conversationId,
                userId: task.user_id,
                role: 'tool',
                content: result,
                toolResult: { tool_use_id: tb.id, content: result },
                parentMessageId: assistantMsg.id,
              });
              return {
                type: 'tool_result' as const,
                tool_use_id: tb.id,
                content: result,
              };
            }),
          );

          currentMessages = [
            ...currentMessages,
            { role: 'assistant', content: response.content },
            { role: 'user', content: toolResults },
          ];
          continue;
        }

        // Anything other than end_turn / tool_use is unexpected; stop the loop.
        console.warn('[chat.respond] unexpected stop_reason:', response.stop_reason);
        break;
      }

      // Persist the final assistant text. Even if all broadcasts failed and
      // the client never saw a single delta, this row is the source of truth
      // and reaches the client via the existing realtime postgres_changes.
      const saved = await addMessage({
        conversationId,
        userId: task.user_id,
        role: 'assistant',
        content: finalContent,
        model: finalModel,
      });
      await touchConversation(conversationId);

      broadcast('done', { message_id: saved.id });

      trace.update({
        output: finalContent,
        tags: usedTools ? ['chat', 'tools'] : ['chat'],
      });

      // Background memory extraction — same pattern the old SSE handler used.
      if (lastUserMessage && finalContent) {
        createTask({
          userId: task.user_id,
          type: 'memory.extract',
          conversationId,
          input: {
            userMessage: lastUserMessage,
            assistantResponse: finalContent,
          },
        }).catch((err) => console.error('[chat.respond] memory.extract dispatch failed:', err));
      }

      return {
        status: 'completed',
        output: {
          message_id: saved.id,
          model: finalModel,
          used_tools: usedTools,
        },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('[chat.respond] error:', err);
      trace.update({ output: errorMessage, tags: ['chat', 'error'] });
      broadcast('error', { error: errorMessage });
      return { status: 'failed', output: { error: errorMessage } };
    } finally {
      await langfuse.flushAsync().catch(() => {
        // Telemetry flush is best-effort.
      });
    }
  },
};
