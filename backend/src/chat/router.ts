import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';
import { createConversation, getConversation, listConversations, addMessage, getMessages, touchConversation, updateConversation, deleteConversation, setConversationTitle } from './db.js';
import { buildSystemPrompt, buildMessages, createStream } from './claude.js';
import { langfuse } from '../telemetry.js';

type AuthEnv = { Variables: { user: User } };

const chat = new Hono<AuthEnv>();

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

// Stream Claude's response as SSE
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

  // Load conversation history and build Claude request
  const history = await getMessages(conversationId, user.id);
  const messages = buildMessages(history);
  const systemPrompt = buildSystemPrompt({ assistantName, userName });

  c.header('X-Accel-Buffering', 'no');

  return streamSSE(c, async (stream) => {
    const trace = langfuse.trace({
      name: 'chat',
      userId: user.id,
      sessionId: conversationId,
      tags: ['chat'],
      input: messages[messages.length - 1]?.content,
    });

    const generation = trace.generation({
      name: 'claude-stream',
      model: 'claude-sonnet-4-5-20250929',
      input: { system: systemPrompt, messages },
    });

    let fullContent = '';
    let model = '';

    try {
      const response = createStream({ messages, systemPrompt });

      response.on('text', (text) => {
        fullContent += text;
        stream.writeSSE({ data: JSON.stringify({ delta: text }) });
      });

      const finalMessage = await response.finalMessage();
      model = finalMessage.model;

      generation.end({
        output: fullContent,
        usage: {
          input: finalMessage.usage.input_tokens,
          output: finalMessage.usage.output_tokens,
        },
      });

      // Save the assistant message
      const saved = await addMessage({
        conversationId,
        userId: user.id,
        role: 'assistant',
        content: fullContent,
        model,
      });

      await touchConversation(conversationId);

      trace.update({ output: fullContent });

      await stream.writeSSE({
        data: JSON.stringify({ done: true, message_id: saved.id }),
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('Stream error:', err);

      generation.end({ level: 'ERROR', statusMessage: errorMessage });
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
