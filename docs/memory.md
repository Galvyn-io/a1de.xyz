# Memory System Architecture

## Overview

A1DE's memory system is a knowledge graph stored in Supabase (PostgreSQL + pgvector). It enables the agent to remember facts about users, search across all stored knowledge, and always-inject core preferences into every conversation.

## How it works

### Storage: Two layers

**Entities** — People, places, companies, preferences, activities. Each entity has a name, type, optional subtype, and an embedding for semantic matching.

**Memories** — Extracted facts with embeddings and full-text search indexes. Each memory points back to its source (email, calendar, chat) and optionally links to entities via a junction table.

No raw data is copied from external sources. Memories are lightweight extracted facts (~50-200 tokens each) with a `source_id` pointer back to the original record in Gmail, Calendar, etc.

### Retrieval: Hybrid search with RRF

The `hybrid_search` SQL function combines:
1. **Vector search** — pgvector HNSW cosine similarity (top 20 candidates)
2. **Full-text search** — PostgreSQL tsvector/BM25 (top 20 candidates)
3. **RRF fusion** — Reciprocal Rank Fusion (k=60) merges both ranked lists

This hybrid approach achieves ~84% retrieval precision vs ~62% for vector-only.

Optional structured prefilters narrow by `category` before search runs.

### Embeddings: Vertex AI

- **Model:** `gemini-embedding-001` via Vertex AI
- **Dimensions:** 1536
- **Region:** `us-west1` (same as Cloud Run + Supabase)
- **Auth:** Application Default Credentials (Cloud Run service account, no API key needed)
- **Future:** Upgradeable to multimodal `gemini-embedding-2-preview` for Photos search

### Tools

Claude has two memory tools:

**`search_memory`** — Semantic + full-text hybrid search across all memories
- Input: `query` (required), `category` (optional), `limit` (optional)
- Uses: "tell me about contractors", "what food do I like?", "Henderson project status"

**`save_fact`** — Save a fact to long-term memory
- Input: `content` (required), `category` (required), `always_inject` (optional), `entities` (optional)
- Uses: "remember that I like sushi", "my friend Mike's birthday is March 15"

### Always-inject memories

Memories with `always_inject = true` are loaded into the system prompt on every conversation turn. These are durable preferences and core facts:
- "Likes sushi, doesn't like eel"
- "Plays golf at Pebble Beach"
- "Allergic to shellfish"

Limited to 50 most recent always-inject memories per user.

### Temporal validity

Memories and entity relations have `valid_from` and `valid_until` timestamps. When a fact is superseded, the old memory gets `valid_until = now()` — it's invalidated, not deleted. Queries default to `WHERE valid_until IS NULL` for current facts only.

## Database schema

### `entities`
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID | Owner |
| name | TEXT | Entity name |
| type | TEXT | person, company, place, preference, activity, topic |
| subtype | TEXT | friend, contractor, golf_course, food, etc. |
| embedding | vector(1536) | For semantic entity matching |

### `memories`
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID | Owner |
| content | TEXT | The fact (1-2 sentences) |
| embedding | vector(1536) | For semantic search |
| source | TEXT | email, calendar, chat, photo, manual |
| source_id | TEXT | Pointer to original record |
| category | TEXT | person, project, finance, health, preference, habit |
| always_inject | BOOLEAN | If true, included in every system prompt |
| content_tsv | tsvector | Auto-generated for full-text search |
| valid_from | TIMESTAMPTZ | When this fact became true |
| valid_until | TIMESTAMPTZ | When superseded (null = current) |

### `entity_relations`
| Column | Type | Description |
|--------|------|-------------|
| from_entity_id | UUID | Source entity |
| to_entity_id | UUID | Target entity |
| relation | TEXT | works_for, hired_for, friends_with, plays_at, etc. |
| valid_from / valid_until | TIMESTAMPTZ | Temporal validity |

### `memory_entities`
Junction table: `memory_id` + `entity_id` (many-to-many)

### `health_metrics`
Raw time-series: `user_id`, `metric`, `value`, `unit`, `recorded_at`, `source`

### `schedules`
User-defined recurring tasks: `cron_expression`, `action_type`, `action_config`

## Key files

- `backend/src/memory/embeddings.ts` — Vertex AI embedding wrapper
- `backend/src/memory/db.ts` — Memory CRUD (addMemory, searchMemories, getAlwaysInject, upsertEntity)
- `backend/src/memory/search.ts` — Hybrid search combining embed + DB query
- `backend/src/memory/tools.ts` — Tool definitions + executor for search_memory and save_fact
- `infra/sql/004_memory.sql` — Full schema, indexes, RLS policies, hybrid_search function

## GCP infrastructure

- **Vertex AI API** enabled on project `a1de-assistant`
- **IAM:** Cloud Run service account (`161515709709-compute@developer.gserviceaccount.com`) has `roles/aiplatform.user`
- No additional API keys needed — uses Application Default Credentials

## Future phases

- **Phase B:** Background extraction from chat messages → memories + entities
- **Phase C:** Gmail/Calendar ingestion → memories
- **Phase D:** Health metrics connector + daily summarizer
- **Phase E:** Proactive engine (daily checks, birthday reminders, pattern detection)
- **Phase F:** User-defined schedules (cron jobs)
