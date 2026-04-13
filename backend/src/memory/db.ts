import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { embed } from './embeddings.js';

function getServiceClient() {
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
}

export interface MemoryRow {
  id: string;
  user_id: string;
  content: string;
  source: string | null;
  source_id: string | null;
  category: string | null;
  always_inject: boolean;
  valid_from: string;
  valid_until: string | null;
  created_at: string;
}

export interface EntityRow {
  id: string;
  user_id: string;
  name: string;
  type: string;
  subtype: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SearchResult {
  id: string;
  content: string;
  category: string | null;
  source: string | null;
  source_id: string | null;
  score: number;
  created_at: string;
}

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

  // Generate embedding
  const embedding = await embed(params.content);

  const { data, error } = await db
    .from('memories')
    .insert({
      user_id: params.userId,
      content: params.content,
      embedding: JSON.stringify(embedding),
      source: params.source ?? null,
      source_id: params.sourceId ?? null,
      category: params.category ?? null,
      always_inject: params.alwaysInject ?? false,
    })
    .select('id, user_id, content, source, source_id, category, always_inject, valid_from, valid_until, created_at')
    .single<MemoryRow>();
  if (error) throw error;

  // Link entities if provided
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

export async function upsertEntity(params: {
  userId: string;
  name: string;
  type: string;
  subtype?: string;
}): Promise<EntityRow> {
  const db = getServiceClient();

  // Check if entity exists (case-insensitive match)
  const { data: existing } = await db
    .from('entities')
    .select('*')
    .eq('user_id', params.userId)
    .ilike('name', params.name)
    .eq('type', params.type)
    .single<EntityRow>();

  if (existing) return existing;

  // Create new entity with embedding
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

export async function invalidateMemory(id: string): Promise<void> {
  const db = getServiceClient();
  const { error } = await db
    .from('memories')
    .update({ valid_until: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

function inferEntityType(name: string, category?: string | null): string {
  if (category === 'person') return 'person';
  if (category === 'preference') return 'preference';
  if (category === 'health') return 'health';
  if (category === 'finance') return 'company';
  return 'topic';
}
