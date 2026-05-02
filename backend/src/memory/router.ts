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
import { buildActivity, type EventRow, type MemoryRow as ActivityMemoryRow } from './activity.js';

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

// Recent relations for an entity (both directions)
memories.get('/entities/:id/relations', requireAuth, async (c) => {
  const user = c.get('user');
  const entityId = c.req.param('id')!;
  const db = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);

  // Verify ownership
  const { data: entity } = await db
    .from('entities')
    .select('id')
    .eq('id', entityId)
    .eq('user_id', user.id)
    .single();
  if (!entity) return c.json({ error: 'Entity not found' }, 404);

  const { data: outgoing } = await db
    .from('entity_relations')
    .select('id, predicate, object_id, entities!entity_relations_object_id_fkey(name, type)')
    .eq('user_id', user.id)
    .eq('subject_id', entityId)
    .is('valid_until', null);

  const { data: incoming } = await db
    .from('entity_relations')
    .select('id, predicate, subject_id, entities!entity_relations_subject_id_fkey(name, type)')
    .eq('user_id', user.id)
    .eq('object_id', entityId)
    .is('valid_until', null);

  return c.json({
    outgoing: outgoing ?? [],
    incoming: incoming ?? [],
  });
});

/**
 * Activity feed — what got added to the graph in the last N days.
 *
 * Returns:
 *   - buckets: per-day counts by source kind for the last `days` days
 *     (kind = 'calendar' | 'gmail_structured' | 'memory' | 'banking')
 *   - totals: cumulative totals across the window
 *   - recent: a small sample of the most recent items per kind for
 *     surfacing in the UI
 *
 * Why aggregate server-side: the events + memories tables can be large
 * over time; we don't want to ship every row to the client. The browser
 * just needs the daily count grid + a recent-items strip.
 */
memories.get('/activity', requireAuth, async (c) => {
  const user = c.get('user');
  const daysParam = parseInt(c.req.query('days') ?? '7', 10);
  const days = Math.min(Math.max(daysParam, 1), 30);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const db = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);

  // Two cheap parallel queries beat one giant join — events and memories
  // live in separate tables and the row counts here are small (< few hundred).
  const [eventsRes, memoriesRes] = await Promise.all([
    db
      .from('events')
      .select('id, title, source, start_at, created_at')
      .eq('user_id', user.id)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .returns<EventRow[]>(),
    db
      .from('memories')
      .select('id, content, source, category, created_at')
      .eq('user_id', user.id)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .returns<ActivityMemoryRow[]>(),
  ]);

  if (eventsRes.error) throw eventsRes.error;
  if (memoriesRes.error) throw memoriesRes.error;

  return c.json(
    buildActivity({
      events: eventsRes.data ?? [],
      memories: memoriesRes.data ?? [],
      days,
      now: new Date(),
    }),
  );
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
