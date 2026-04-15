import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';
import { createConversation, getConversation, listConversations, addMessage, getMessages, touchConversation, updateConversation, deleteConversation, setConversationTitle } from './db.js';
import { buildSystemPrompt, buildMessages, callClaude, streamClaude } from './claude.js';
import { langfuse } from '../telemetry.js';
import { MEMORY_TOOLS, executeTool as executeMemoryTool } from '../memory/tools.js';
import { GOLF_TOOLS, executeGolfTool } from '../golf/tools.js';
import { INGESTION_TOOLS, executeIngestionTool } from '../ingestion/tools.js';
import { getAlwaysInjectMemories } from '../memory/db.js';
import { createTask } from '../tasks/index.js';

const WEB_SEARCH_TOOL = {
  type: 'web_search_20250305' as const,
  name: 'web_search',
  max_uses: 5,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ALL_TOOLS: any[] = [...MEMORY_TOOLS, ...GOLF_TOOLS, ...INGESTION_TOOLS, WEB_SEARCH_TOOL];

const GOLF_TOOL_NAMES = new Set(GOLF_TOOLS.map((t) => t.name));
const INGESTION_TOOL_NAMES = new Set(INGESTION_TOOLS.map((t) => t.name));

async function executeTool(name: string, input: unknown, userId: string, conversationId?: string): Promise<string> {
  if (GOLF_TOOL_NAMES.has(name)) {
    return executeGolfTool(name, input, userId, conversationId);
  }
  if (INGESTION_TOOL_NAMES.has(name)) {
    return executeIngestionTool(name, input, userId);
  }
  return executeMemoryTool(name, input, userId);
}

type AuthEnv = { Variables: { user: User } };

const chat = new Hono<AuthEnv>();

const MAX_TOOL_ITERATIONS = 5;

// Send a message — creates conversation if needed, saves user message
chat.post('/', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ conversation_id?: string; message: string }>();

  if (!body.message?.trim()) {
    return c.json({ error: 'Message is required' }, 400);
  }

  let conversationId = body.conversation_id;

  if (conversationId) {
    const conversation = await getConversation(conversationId, user.id);
    if (!conversation) {
      return c.json({ error: 'Conversation not found' }, 404);
    }
  } else {
    const conversation = await createConversation(user.id);
    conversationId = conversation.id;
  }

  const messageText = body.message.trim();

  const userMessage = await addMessage({
    conversationId,
    userId: user.id,
    role: 'user',
    content: messageText,
  });

  // Auto-title new conversations with the first message (truncated)
  if (!body.conversation_id) {
    const title = messageText.length > 60 ? messageText.slice(0, 57) + '...' : messageText;
    await setConversationTitle(conversationId, title);
  }

  return c.json({ conversation_id: conversationId, message_id: userMessage.id });
});

// Stream Claude's response as SSE — with tool-use loop
chat.get('/stream', requireAuth, async (c) => {
  const user = c.get('user');
  const conversationId = c.req.query('conversation_id');

  if (!conversationId) {
    return c.json({ error: 'conversation_id is required' }, 400);
  }

  const conversation = await getConversation(conversationId, user.id);
  if (!conversation) {
    return c.json({ error: 'Conversation not found' }, 404);
  }

  // Load user profile for system prompt
  const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('assistant_name, email')
    .eq('id', user.id)
    .single<{ assistant_name: string | null; email: string }>();

  const assistantName = profile?.assistant_name ?? 'A1DE';
  const userName = profile?.email?.split('@')[0] ?? 'there';

  // Load always-inject memories
  const alwaysInjectMemories = await getAlwaysInjectMemories(user.id);

  // Load conversation history and build Claude request
  const history = await getMessages(conversationId, user.id);
  const systemPrompt = buildSystemPrompt({ assistantName, userName, alwaysInjectMemories });

  c.header('X-Accel-Buffering', 'no');

  return streamSSE(c, async (stream) => {
    const trace = langfuse.trace({
      name: 'chat',
      userId: user.id,
      sessionId: conversationId,
      tags: ['chat'],
      input: history[history.length - 1]?.content,
    });

    let currentMessages = buildMessages(history);
    let finalContent = '';
    let finalModel = '';
    let usedTools = false;

    try {
      // Tool-use loop
      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
        const isFirstIteration = iteration === 0;

        // Use tools on all iterations (Claude decides whether to call them)
        const response = await callClaude({
          messages: currentMessages,
          systemPrompt,
          tools: ALL_TOOLS,
        });

        finalModel = response.model;

        // Record Langfuse generation
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
          // Final response — stream text to client
          for (const block of response.content) {
            if (block.type === 'text') {
              finalContent += block.text;
              // Stream in chunks for a typing effect
              const text = block.text;
              const chunkSize = 20;
              for (let i = 0; i < text.length; i += chunkSize) {
                await stream.writeSSE({
                  data: JSON.stringify({ delta: text.slice(i, i + chunkSize) }),
                });
              }
            }
          }
          break;
        }

        if (response.stop_reason === 'tool_use') {
          usedTools = true;
          const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
          const textBlocks = response.content.filter((b) => b.type === 'text');

          // Notify client about tool calls
          for (const tb of toolUseBlocks) {
            if (tb.type === 'tool_use') {
              await stream.writeSSE({
                data: JSON.stringify({ tool_call: { name: tb.name, input: tb.input } }),
              });
            }
          }

          // Save assistant message with tool_calls
          const assistantMsg = await addMessage({
            conversationId,
            userId: user.id,
            role: 'assistant',
            content: textBlocks.filter((b) => b.type === 'text').map((b) => b.type === 'text' ? b.text : '').join('') || undefined,
            toolCalls: toolUseBlocks,
            model: response.model,
          });

          // Execute tools in parallel
          const toolResults = await Promise.all(
            toolUseBlocks.map(async (tb) => {
              if (tb.type !== 'tool_use') return null;
              const result = await executeTool(tb.name, tb.input, user.id, conversationId);

              // Save tool result message
              await addMessage({
                conversationId,
                userId: user.id,
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

          // Extend message history for next iteration
          currentMessages = [
            ...currentMessages,
            { role: 'assistant' as const, content: response.content },
            { role: 'user' as const, content: toolResults.filter(Boolean) as Array<{ type: 'tool_result'; tool_use_id: string; content: string }> },
          ];

          continue;
        }

        // Unknown stop reason — break
        break;
      }

      // Save final assistant message
      const saved = await addMessage({
        conversationId,
        userId: user.id,
        role: 'assistant',
        content: finalContent,
        model: finalModel,
      });

      await touchConversation(conversationId);

      trace.update({
        output: finalContent,
        tags: usedTools ? ['chat', 'tools'] : ['chat'],
      });

      await stream.writeSSE({
        data: JSON.stringify({ done: true, message_id: saved.id }),
      });

      // Background: extract memories from this conversation turn via the task system
      const lastUserMessage = history.filter((m) => m.role === 'user').pop();
      if (lastUserMessage?.content && finalContent) {
        createTask({
          userId: user.id,
          type: 'memory.extract',
          conversationId,
          input: {
            userMessage: lastUserMessage.content,
            assistantResponse: finalContent,
          },
        }).catch((err) => console.error('Background extraction task failed:', err));
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('Stream error:', err);

      trace.update({ output: errorMessage, tags: ['chat', 'error'] });

      await stream.writeSSE({
        data: JSON.stringify({ error: errorMessage }),
      });
    } finally {
      await langfuse.flushAsync();
    }
  });
});

// List conversations
chat.get('/conversations', requireAuth, async (c) => {
  const user = c.get('user');
  const conversations = await listConversations(user.id);
  return c.json({ conversations });
});

// Get messages for a conversation
chat.get('/conversations/:id/messages', requireAuth, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id')!;
  const messages = await getMessages(id, user.id);
  return c.json({ messages });
});

// Rename a conversation
chat.patch('/conversations/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id')!;
  const body = await c.req.json<{ title: string }>();

  if (!body.title?.trim()) {
    return c.json({ error: 'Title is required' }, 400);
  }

  const updated = await updateConversation(id, user.id, { title: body.title.trim() });
  if (!updated) {
    return c.json({ error: 'Conversation not found' }, 404);
  }
  return c.json({ conversation: updated });
});

// Delete a conversation
chat.delete('/conversations/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id')!;

  const conversation = await getConversation(id, user.id);
  if (!conversation) {
    return c.json({ error: 'Conversation not found' }, 404);
  }

  await deleteConversation(id, user.id);
  return c.json({ ok: true });
});

export { chat };
