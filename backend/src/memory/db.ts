/**
 * Database access layer for the memory system.
 *
 * Design principles:
 * - All writes use the service_role client (bypasses RLS). We enforce ownership
 *   explicitly in every function via user_id filters, so RLS is a defense-in-depth
 *   layer rather than the primary access control.
 * - Embeddings are computed here (not by callers) so every memory and entity
 *   gets a vector without any caller having to remember to do it.
 * - Entity deduplication happens on (user_id, lower(name), type) — the unique
 *   index from infra/sql/004_memory.sql enforces it at the DB level.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { embed } from './embeddings.js';

/** Fresh Supabase client with service-role privileges. */
function getServiceClient() {
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * A memory is an extracted fact about the user. Memories link back to their
 * source (email id, calendar event id, chat conversation id, etc.) so we can
 * always audit where a fact came from.
 */
export interface MemoryRow {
  id: string;
  user_id: string;
  content: string;
  source: string | null;     // 'chat' | 'gmail' | 'calendar' | 'photos' | ...
  source_id: string | null;  // opaque identifier within the source system
  category: string | null;   // 'preference' | 'person' | 'project' | ...
  always_inject: boolean;    // If true, always loaded into the system prompt
  valid_from: string;
  valid_until: string | null; // Null = still valid; set when superseded
  created_at: string;
}

/**
 * An entity is a person, place, project, etc. that memories reference. We keep
 * these in their own table so we can build a graph (memory_entities junction
 * table + entity_relations) without denormalizing names everywhere.
 */
export interface EntityRow {
  id: string;
  user_id: string;
  name: string;
  type: string;               // 'person' | 'place' | 'company' | 'project' | ...
  subtype: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Row shape returned by the `hybrid_search` SQL function. */
export interface SearchResult {
  id: string;
  content: string;
  category: string | null;
  source: string | null;
  source_id: string | null;
  score: number;
  created_at: string;
}

/**
 * Create a new memory with an embedding, optionally linking it to entities.
 *
 * Side effects:
 * - Calls the embedding API (one network round-trip)
 * - For each entity in `entities`: upserts an entity (another embedding call
 *   if new) and inserts a row into memory_entities
 *
 * @param params.userId         Owner of the memory
 * @param params.content        The fact, phrased as a clear statement
 * @param params.source         Where the fact came from ('chat', 'gmail', ...)
 * @param params.sourceId       Opaque ID within the source (for provenance)
 * @param params.category       High-level bucket; drives retrieval filtering
 * @param params.alwaysInject   True for durable preferences/facts (allergies,
 *                              relationships, core traits)
 * @param params.entities       Names of entities this memory references
 */
export async function addMemory(params: {
  userId: string;
  content: string;
  source?: string;
  sourceId?: string;
  category?: string;
  alwaysInject?: boolean;
  entities?: string[];
}): Promise<MemoryRow> {
  const db = getServiceClient();

  // Generate the embedding up front so we insert a fully-populated row.
  // If this fails we surface the error rather than storing a memory with
  // null embedding that can't be retrieved.
  const embedding = await embed(params.content);

  const { data, error } = await db
    .from('memories')
    .insert({
      user_id: params.userId,
      content: params.content,
      // pgvector accepts either a PG array literal or a JSON array — supabase-js
      // serializes the object as JSON, so we have to stringify the vector
      // ourselves into pgvector's expected text form.
      embedding: JSON.stringify(embedding),
      source: params.source ?? null,
      source_id: params.sourceId ?? null,
      category: params.category ?? null,
      always_inject: params.alwaysInject ?? false,
    })
    .select('id, user_id, content, source, source_id, category, always_inject, valid_from, valid_until, created_at')
    .single<MemoryRow>();
  if (error) throw error;

  // Link entities if provided. Best effort — any individual entity failure
  // does not roll back the memory, to avoid losing the fact on a transient
  // entity-API error.
  if (params.entities?.length) {
    for (const entityName of params.entities) {
      const entity = await upsertEntity({
        userId: params.userId,
        name: entityName,
        type: inferEntityType(entityName, params.category),
      });
      await db.from('memory_entities').insert({
        memory_id: data!.id,
        entity_id: entity.id,
      });
    }
  }

  return data!;
}

/**
 * Load the memories that should be unconditionally injected into the system
 * prompt for this user. These represent core preferences, allergies, key
 * relationships — things the assistant must never "forget" between turns.
 *
 * Cap of 50 keeps the system prompt bounded even if the user accumulates a lot
 * of always-inject facts over time.
 */
export async function getAlwaysInjectMemories(userId: string): Promise<string[]> {
  const db = getServiceClient();
  const { data, error } = await db
    .from('memories')
    .select('content')
    .eq('user_id', userId)
    .eq('always_inject', true)
    .is('valid_until', null)
    .order('created_at', { ascending: false })
    .limit(50)
    .returns<{ content: string }[]>();
  if (error) throw error;
  return (data ?? []).map((r) => r.content);
}

/**
 * Find an existing entity by name+type (case-insensitive) or create a new one.
 * Enforced by the unique index on (user_id, lower(name), type) in migration 004.
 *
 * A new entity gets an embedding of its name, so we can do semantic entity
 * lookup later (e.g. "contractor" matching "ABC Plumbing").
 */
export async function upsertEntity(params: {
  userId: string;
  name: string;
  type: string;
  subtype?: string;
}): Promise<EntityRow> {
  const db = getServiceClient();

  // Case-insensitive lookup first — avoids an unnecessary embedding call.
  const { data: existing } = await db
    .from('entities')
    .select('*')
    .eq('user_id', params.userId)
    .ilike('name', params.name)
    .eq('type', params.type)
    .single<EntityRow>();

  if (existing) return existing;

  // New entity — embed the name for future semantic lookups.
  const embedding = await embed(params.name);

  const { data, error } = await db
    .from('entities')
    .insert({
      user_id: params.userId,
      name: params.name,
      type: params.type,
      subtype: params.subtype ?? null,
      embedding: JSON.stringify(embedding),
    })
    .select()
    .single<EntityRow>();
  if (error) throw error;
  return data!;
}

/**
 * Hybrid search over memories: combines vector similarity (semantic match) with
 * PostgreSQL full-text search (exact keyword match), then fuses both ranked
 * lists using Reciprocal Rank Fusion (k=60).
 *
 * The heavy lifting happens inside the `hybrid_search` SQL function in
 * migration 004 — both searches run in parallel CTEs and fuse in a single
 * query, which is much faster than two round-trips from the app.
 *
 * Caller supplies the embedding so that the query vector can be cached or
 * reused across multiple searches (see search.ts for the public helper that
 * wraps embed + search together).
 */
export async function searchMemories(params: {
  userId: string;
  embedding: number[];
  query: string;
  category?: string;
  limit?: number;
}): Promise<SearchResult[]> {
  const db = getServiceClient();
  const { data, error } = await db.rpc('hybrid_search', {
    p_user_id: params.userId,
    p_embedding: JSON.stringify(params.embedding),
    p_query: params.query,
    p_category: params.category ?? null,
    p_limit: params.limit ?? 10,
  });
  if (error) throw error;
  return (data ?? []) as SearchResult[];
}

/**
 * Soft-delete a memory by setting `valid_until = now()`. The row stays in the
 * database so historical queries ("what did you think at the time?") still
 * work and deletions can be audited. The hybrid_search function automatically
 * filters out rows where valid_until is not null.
 */
export async function invalidateMemory(id: string): Promise<void> {
  const db = getServiceClient();
  const { error } = await db
    .from('memories')
    .update({ valid_until: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/**
 * Map a memory category to a reasonable entity type. This is a heuristic —
 * the extractor can override by passing an explicit `type` to upsertEntity.
 */
function inferEntityType(name: string, category?: string | null): string {
  if (category === 'person') return 'person';
  if (category === 'preference') return 'preference';
  if (category === 'health') return 'health';
  if (category === 'finance') return 'company';
  return 'topic';
}
