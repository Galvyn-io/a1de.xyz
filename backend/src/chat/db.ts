import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

function getServiceClient() {
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
}

export interface ConversationRow {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  user_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls: unknown | null;
  tool_result: unknown | null;
  model: string | null;
  created_at: string;
}

export async function createConversation(userId: string): Promise<ConversationRow> {
  const db = getServiceClient();
  const { data, error } = await db
    .from('conversations')
    .insert({ user_id: userId })
    .select()
    .single<ConversationRow>();
  if (error) throw error;
  return data!;
}

export async function getConversation(id: string, userId: string): Promise<ConversationRow | null> {
  const db = getServiceClient();
  const { data, error } = await db
    .from('conversations')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single<ConversationRow>();
  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found
  return data;
}

export async function listConversations(userId: string): Promise<ConversationRow[]> {
  const db = getServiceClient();
  const { data, error } = await db
    .from('conversations')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .returns<ConversationRow[]>();
  if (error) throw error;
  return data ?? [];
}

export async function addMessage(params: {
  conversationId: string;
  userId: string;
  role: 'user' | 'assistant' | 'tool';
  content?: string;
  toolCalls?: unknown;
  toolResult?: unknown;
  model?: string;
}): Promise<MessageRow> {
  const db = getServiceClient();
  const { data, error } = await db
    .from('messages')
    .insert({
      conversation_id: params.conversationId,
      user_id: params.userId,
      role: params.role,
      content: params.content ?? null,
      tool_calls: params.toolCalls ?? null,
      tool_result: params.toolResult ?? null,
      model: params.model ?? null,
    })
    .select()
    .single<MessageRow>();
  if (error) throw error;
  return data!;
}

export async function getMessages(conversationId: string, userId: string): Promise<MessageRow[]> {
  // Verify ownership first
  const conversation = await getConversation(conversationId, userId);
  if (!conversation) return [];

  const db = getServiceClient();
  const { data, error } = await db
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .returns<MessageRow[]>();
  if (error) throw error;
  return data ?? [];
}

export async function touchConversation(id: string): Promise<void> {
  const db = getServiceClient();
  const { error } = await db
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}
