import { Hono } from 'hono';
import type { User } from '@supabase/supabase-js';
import { requireAuth } from '../middleware/auth.js';
import {
  createConversation,
  getConversation,
  listConversations,
  addMessage,
  getMessages,
  updateConversation,
  deleteConversation,
  setConversationTitle,
} from './db.js';
import { createTask } from '../tasks/index.js';

type AuthEnv = { Variables: { user: User } };

const chat = new Hono<AuthEnv>();

/**
 * POST /chat — accept a user message and start a `chat.respond` task.
 *
 * The task runs the full agent loop (streaming via Anthropic + tool use)
 * server-side. It writes the final assistant message to the `messages`
 * table, so the client gets the response via Supabase realtime even if
 * it disconnects mid-response. Live token deltas are pushed over a
 * realtime broadcast channel `chat:{conversationId}`.
 */
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

  // Auto-title new conversations with the first message (truncated).
  if (!body.conversation_id) {
    const title = messageText.length > 60 ? messageText.slice(0, 57) + '...' : messageText;
    await setConversationTitle(conversationId, title);
  }

  // Enqueue the agent. The task handler streams deltas via realtime broadcast
  // and persists the final assistant message regardless of client presence.
  const task = await createTask({
    userId: user.id,
    type: 'chat.respond',
    conversationId,
    input: { conversationId },
  });

  return c.json({
    conversation_id: conversationId,
    message_id: userMessage.id,
    task_id: task.id,
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
