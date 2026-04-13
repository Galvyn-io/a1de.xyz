-- 004_memory.sql
-- Knowledge graph: entities, memories, relations, health metrics, schedules
-- Apply via Supabase SQL Editor

-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- Entities: people, places, companies, preferences, activities
-- ============================================================
CREATE TABLE public.entities (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    type       TEXT NOT NULL,  -- person, company, place, preference, activity, topic
    subtype    TEXT,           -- friend, contractor, employer, golf_course, food, etc.
    metadata   JSONB DEFAULT '{}',
    embedding  vector(1536),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.entities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own entities"
    ON public.entities FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own entities"
    ON public.entities FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all entities"
    ON public.entities FOR SELECT USING (public.is_admin());

CREATE TRIGGER on_entity_updated
    BEFORE UPDATE ON public.entities
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE INDEX idx_entities_user_id ON public.entities(user_id);
CREATE INDEX idx_entities_user_type ON public.entities(user_id, type);
CREATE INDEX idx_entities_embedding ON public.entities USING hnsw (embedding vector_cosine_ops);
-- Dedupe index: prevent duplicate entity names per user
CREATE UNIQUE INDEX idx_entities_user_name ON public.entities(user_id, lower(name), type);

-- ============================================================
-- Memories: extracted facts with embeddings + full-text search
-- ============================================================
CREATE TABLE public.memories (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    content       TEXT NOT NULL,
    embedding     vector(1536),
    source        TEXT,           -- email, calendar, chat, photo, manual
    source_id     TEXT,           -- pointer to raw record in external system
    category      TEXT,           -- person, project, finance, health, preference, habit
    always_inject BOOLEAN DEFAULT false,
    content_tsv   tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    valid_from    TIMESTAMPTZ DEFAULT now(),
    valid_until   TIMESTAMPTZ,   -- null = current; set when superseded
    created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own memories"
    ON public.memories FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own memories"
    ON public.memories FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all memories"
    ON public.memories FOR SELECT USING (public.is_admin());

CREATE INDEX idx_memories_user_id ON public.memories(user_id);
CREATE INDEX idx_memories_user_category ON public.memories(user_id, category);
CREATE INDEX idx_memories_always_inject ON public.memories(user_id) WHERE always_inject = true AND valid_until IS NULL;
CREATE INDEX idx_memories_embedding ON public.memories USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_memories_content_tsv ON public.memories USING gin (content_tsv);

-- ============================================================
-- Entity relations: directed edges between entities
-- ============================================================
CREATE TABLE public.entity_relations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_entity_id  UUID NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
    to_entity_id    UUID NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
    relation        TEXT NOT NULL,  -- works_for, hired_for, friends_with, plays_at, prefers, etc.
    metadata        JSONB DEFAULT '{}',
    valid_from      TIMESTAMPTZ DEFAULT now(),
    valid_until     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.entity_relations ENABLE ROW LEVEL SECURITY;

-- RLS via parent entity user_id
CREATE POLICY "Users can view own entity relations"
    ON public.entity_relations FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.entities e WHERE e.id = from_entity_id AND e.user_id = auth.uid()));
CREATE POLICY "Admins can view all entity relations"
    ON public.entity_relations FOR SELECT USING (public.is_admin());

CREATE INDEX idx_entity_relations_from ON public.entity_relations(from_entity_id);
CREATE INDEX idx_entity_relations_to ON public.entity_relations(to_entity_id);

-- ============================================================
-- Memory-Entity junction: many-to-many
-- ============================================================
CREATE TABLE public.memory_entities (
    memory_id  UUID NOT NULL REFERENCES public.memories(id) ON DELETE CASCADE,
    entity_id  UUID NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
    PRIMARY KEY (memory_id, entity_id)
);

ALTER TABLE public.memory_entities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own memory entities"
    ON public.memory_entities FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.memories m WHERE m.id = memory_id AND m.user_id = auth.uid()));
CREATE POLICY "Admins can view all memory entities"
    ON public.memory_entities FOR SELECT USING (public.is_admin());

-- ============================================================
-- Health metrics: raw time-series data
-- ============================================================
CREATE TABLE public.health_metrics (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    metric      TEXT NOT NULL,    -- weight, steps, heart_rate, sleep_hours, etc.
    value       NUMERIC NOT NULL,
    unit        TEXT NOT NULL,    -- lbs, steps, bpm, hours
    recorded_at TIMESTAMPTZ NOT NULL,
    source      TEXT,             -- apple_health, whoop, manual
    UNIQUE(user_id, metric, recorded_at)
);

ALTER TABLE public.health_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own health metrics"
    ON public.health_metrics FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own health metrics"
    ON public.health_metrics FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all health metrics"
    ON public.health_metrics FOR SELECT USING (public.is_admin());

CREATE INDEX idx_health_metrics_user_metric_time
    ON public.health_metrics(user_id, metric, recorded_at DESC);

-- ============================================================
-- Schedules: user-defined recurring tasks
-- ============================================================
CREATE TABLE public.schedules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    description     TEXT NOT NULL,
    cron_expression TEXT NOT NULL,
    action_type     TEXT NOT NULL,  -- remind, check, summarize, execute
    action_config   JSONB DEFAULT '{}',
    last_run_at     TIMESTAMPTZ,
    next_run_at     TIMESTAMPTZ,
    enabled         BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own schedules"
    ON public.schedules FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own schedules"
    ON public.schedules FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all schedules"
    ON public.schedules FOR SELECT USING (public.is_admin());

CREATE INDEX idx_schedules_user_id ON public.schedules(user_id);
CREATE INDEX idx_schedules_next_run ON public.schedules(next_run_at) WHERE enabled = true;

-- ============================================================
-- Add parent_message_id to messages (for tool result grouping)
-- ============================================================
ALTER TABLE public.messages
    ADD COLUMN parent_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL;

-- ============================================================
-- Hybrid search function: vector + full-text with RRF fusion
-- ============================================================
CREATE OR REPLACE FUNCTION public.hybrid_search(
    p_user_id  UUID,
    p_embedding vector(1536),
    p_query    TEXT,
    p_category TEXT DEFAULT NULL,
    p_limit    INT DEFAULT 10
)
RETURNS TABLE(id UUID, content TEXT, category TEXT, source TEXT, source_id TEXT, score FLOAT8, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    WITH vector_results AS (
        SELECT m.id, m.content, m.category, m.source, m.source_id, m.created_at,
               ROW_NUMBER() OVER (ORDER BY m.embedding <=> p_embedding) AS rn
        FROM public.memories m
        WHERE m.user_id = p_user_id
          AND m.valid_until IS NULL
          AND (p_category IS NULL OR p_category = 'all' OR m.category = p_category)
        ORDER BY m.embedding <=> p_embedding
        LIMIT 20
    ),
    text_results AS (
        SELECT m.id, m.content, m.category, m.source, m.source_id, m.created_at,
               ROW_NUMBER() OVER (
                   ORDER BY ts_rank_cd(m.content_tsv, plainto_tsquery('english', p_query)) DESC
               ) AS rn
        FROM public.memories m
        WHERE m.user_id = p_user_id
          AND m.valid_until IS NULL
          AND (p_category IS NULL OR p_category = 'all' OR m.category = p_category)
          AND m.content_tsv @@ plainto_tsquery('english', p_query)
        ORDER BY ts_rank_cd(m.content_tsv, plainto_tsquery('english', p_query)) DESC
        LIMIT 20
    )
    SELECT
        COALESCE(v.id, t.id) AS id,
        COALESCE(v.content, t.content) AS content,
        COALESCE(v.category, t.category) AS category,
        COALESCE(v.source, t.source) AS source,
        COALESCE(v.source_id, t.source_id) AS source_id,
        (COALESCE(1.0 / (60.0 + v.rn), 0.0) + COALESCE(1.0 / (60.0 + t.rn), 0.0))::FLOAT8 AS score,
        COALESCE(v.created_at, t.created_at) AS created_at
    FROM vector_results v
    FULL OUTER JOIN text_results t ON v.id = t.id
    ORDER BY score DESC
    LIMIT p_limit;
END;
$$;
