/**
 * HTTP routes for the memory management UI (/memories page).
 *
 * These endpoints power the user-facing memory browser — list, delete,
 * explore entities. They are NOT the tools Claude uses during chat; those
 * are in memory/tools.ts and go through the tool-use API.
 *
 * Auth: all endpoints require a valid Supabase JWT (Bearer token). Each handler
 * scopes queries to the caller's user_id explicitly.
 */
import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import type { User } from '@supabase/supabase-js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';
import { invalidateMemory, type MemoryRow, type EntityRow } from './db.js';

type AuthEnv = { Variables: { user: User } };

const memories = new Hono<AuthEnv>();

// List all current memories for user, grouped by category
memories.get('/', requireAuth, async (c) => {
  const user = c.get('user');
  const db = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);

  const { data, error } = await db
    .from('memories')
    .select('id, content, source, category, always_inject, created_at')
    .eq('user_id', user.id)
    .is('valid_until', null)
    .order('created_at', { ascending: false })
    .returns<Pick<MemoryRow, 'id' | 'content' | 'source' | 'category' | 'always_inject' | 'created_at'>[]>();
  if (error) throw error;

  return c.json({ memories: data ?? [] });
});

// List all entities for user
memories.get('/entities', requireAuth, async (c) => {
  const user = c.get('user');
  const db = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);

  const { data, error } = await db
    .from('entities')
    .select('id, name, type, subtype, created_at')
    .eq('user_id', user.id)
    .order('name', { ascending: true })
    .returns<Pick<EntityRow, 'id' | 'name' | 'type' | 'subtype' | 'created_at'>[]>();
  if (error) throw error;

  return c.json({ entities: data ?? [] });
});

// Get memories linked to an entity
memories.get('/entities/:id/memories', requireAuth, async (c) => {
  const user = c.get('user');
  const entityId = c.req.param('id')!;
  const db = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);

  // Verify entity belongs to user
  const { data: entity } = await db
    .from('entities')
    .select('id')
    .eq('id', entityId)
    .eq('user_id', user.id)
    .single();
  if (!entity) return c.json({ error: 'Entity not found' }, 404);

  const { data, error } = await db
    .from('memory_entities')
    .select('memory_id, memories(id, content, source, category, always_inject, created_at)')
    .eq('entity_id', entityId)
    .returns<Array<{ memory_id: string; memories: Pick<MemoryRow, 'id' | 'content' | 'source' | 'category' | 'always_inject' | 'created_at'> }>>();
  if (error) throw error;

  const linkedMemories = (data ?? [])
    .map((r) => r.memories)
    .filter(Boolean);

  return c.json({ memories: linkedMemories });
});

// Delete (invalidate) a memory
memories.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id')!;
  const db = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);

  // Verify memory belongs to user
  const { data: memory } = await db
    .from('memories')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();
  if (!memory) return c.json({ error: 'Memory not found' }, 404);

  await invalidateMemory(id);
  return c.json({ ok: true });
});

export { memories };
