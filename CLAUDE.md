# A1DE — Claude Code Project Context

A1DE (formerly "Jarvis") is a personal family AI assistant. Monorepo with Next.js web app, TypeScript backend, and infrastructure. iOS app planned for Phase 3.

## Architecture

- **Web app:** Next.js 15 (App Router) on Vercel under the Galvyn team — `app.a1de.xyz`
- **Backend:** TypeScript + Hono on GCP Cloud Run (project: `a1de-assistant`)
- **Database:** PostgreSQL + pgvector on Supabase (project ref: `erwowjlaakatqsvuppzj`, region: us-west-1)
- **Intelligence:** Claude Sonnet 4.5 API (streaming chat implemented, tool use coming next)
- **Telemetry:** Langfuse via OpenTelemetry (traces all Claude calls with user/session context)
- **Design system:** Premiere v3 — Outfit font, zinc-black dark-first, 12px radii, 1.5px strokes

## Current state (Phase 0 complete, Phase 1 in progress)

**What's built:**
- Google OAuth login + registration flow (Supabase Auth)
- Admin dashboard (user list, admin-only access)
- Connector system: OAuth flow to connect Gmail, Google Calendar, Google Photos
- Connector management UI (add, view, disconnect)
- Backend API: connector CRUD + Google OAuth token exchange/refresh
- Chat system: streaming Claude Sonnet responses via SSE, conversation persistence
- Chat UI: conversation sidebar, message bubbles, streaming display, tool status display
- Memory system: knowledge graph (entities + memories + relations) with hybrid search (vector + full-text + RRF)
- Tool-use loop: Claude can call `search_memory` and `save_fact` tools, with multi-turn execution
- Always-inject memories: core preferences loaded into every system prompt
- Embeddings: Vertex AI Gemini Embedding (gemini-embedding-001, 1536 dims) via Application Default Credentials
- Langfuse telemetry: tracing of all Claude API calls with token usage, latency, cost, tool iterations
- Backend deployed to Cloud Run (`a1de-backend` in `us-west1`)
- Background memory extraction (Haiku runs after each chat turn, extracts facts to knowledge graph)
- Unified task system: every async op (golf search/book, memory extract, future cron/connector syncs) flows through `backend/src/tasks/`. `/tasks` UI shows live status via Supabase realtime. Cloud Scheduler polls running tasks every minute.
- Golf tools: GolfCourseAPI for course lookup, Skyvern for browser-automated tee time search + booking, verified booking URLs cached to memory
- Banking connector: Plaid Link for bank account OAuth (production creds stored)
- Web search tool: Claude's native `web_search_20250305` for real-time info
- Database: `user_profiles`, `connectors`, `connector_credentials`, `conversations`, `messages`, `entities`, `memories`, `entity_relations`, `memory_entities`, `health_metrics`, `schedules`, `tasks` tables with RLS

**What's NOT built yet:**
- Connector ingestion (Gmail/Calendar → memories)
- Health metrics connector (Apple Health/Whoop → health_metrics table)
- Proactive engine (daily checks, reminders, pattern detection)
- User-defined schedules (cron jobs)
- Messaging channels (Sendblue, Kapso, Twilio)
- iOS app

## Repo structure (actual)

```
backend/
├── package.json
├── tsconfig.json
├── Dockerfile
└── src/
    ├── config.ts             # zod-validated env vars
    ├── index.ts              # Hono app, mounts /connectors + /chat
    ├── telemetry.ts          # Langfuse + OpenTelemetry setup (imported first)
    ├── middleware/
    │   └── auth.ts           # JWT verification via Supabase
    ├── connectors/
    │   ├── router.ts         # CRUD + OAuth callback routes
    │   ├── providers.ts      # Provider registry (scopes, auth type)
    │   ├── db.ts             # Supabase queries (service_role)
    │   └── google-oauth.ts   # OAuth URL, code exchange, token refresh
    ├── chat/
    │   ├── router.ts         # POST /chat, GET /stream (SSE + tool loop), conversations
    │   ├── db.ts             # Conversation + message persistence
    │   └── claude.ts         # Claude API wrapper, system prompt, tool-use
    ├── memory/
    │   ├── embeddings.ts     # Vertex AI Gemini Embedding wrapper
    │   ├── db.ts             # Memory + entity CRUD, hybrid search
    │   ├── search.ts         # Public hybrid search API
    │   ├── extractor.ts      # Background fact extraction from conversations (Haiku)
    │   └── tools.ts          # search_memory + save_fact tool definitions + executor
    ├── golf/
    │   ├── golfcourseapi.ts  # Course lookup via GolfCourseAPI
    │   ├── places.ts         # Google Places geocoding helper
    │   ├── skyvern.ts        # Skyvern API wrapper (browser automation)
    │   └── tools.ts          # search_golf_courses, check_tee_times_at_course, book_tee_time
    └── tasks/
        ├── types.ts          # TaskHandler interface, TaskRow type
        ├── registry.ts       # Handler registration
        ├── runner.ts         # createTask, runTask, pollRunningTasks
        ├── db.ts             # Supabase CRUD for tasks
        ├── router.ts         # GET /tasks, GET /tasks/:id, POST /tasks/poll
        ├── chat-notifier.ts  # Append task results to a chat conversation
        ├── index.ts          # registerAllHandlers() — call once at startup
        └── handlers/         # One file per task type (golf.search, memory.extract, ...)

web/app/
├── src/
│   ├── app/
│   │   ├── layout.tsx        # Root layout (Outfit font, dark mode)
│   │   ├── page.tsx          # Redirect to login/dashboard
│   │   ├── login/            # Google OAuth login
│   │   ├── register/         # Choose assistant name
│   │   ├── dashboard/        # Protected dashboard
│   │   ├── chat/             # Chat UI (streaming, conversation sidebar, realtime messages)
│   │   ├── memories/         # Memory browser (list/delete facts and entities)
│   │   ├── tasks/            # Tasks dashboard (live status via Supabase realtime)
│   │   ├── connectors/       # List, add, manage connectors
│   │   ├── admin/            # Admin-only user list
│   │   └── auth/callback/    # OAuth callback handler
│   ├── lib/
│   │   ├── connectors.ts     # Shared provider metadata (labels, icons, options)
│   │   └── supabase/         # Client, server, types
│   └── middleware.ts         # Session refresh
└── package.json

packages/supabase/             # Shared types (ConnectorType, ConnectorProvider, etc.)

infra/sql/
├── 001_user_profiles.sql     # user_profiles table, RLS, admin trigger
├── 002_connectors.sql        # connectors + connector_credentials tables, RLS
├── 003_conversations.sql     # conversations + messages tables, RLS
├── 004_memory.sql            # entities, memories, relations, health, schedules, hybrid_search
└── 005_tasks.sql             # tasks table + realtime publication

docs/
├── auth.md                   # Authentication architecture
├── chat.md                   # Chat system + tool-use loop
├── connectors.md             # Connector system architecture
├── deployment.md             # Vercel + Cloud Run + Vertex AI + Cloud Scheduler
├── memory.md                 # Memory system (knowledge graph, hybrid search, tools)
└── tasks.md                  # Unified async task system
```

## Adding a new connector provider

When adding a new provider, update ALL of these locations:
1. `backend/src/connectors/providers.ts` — Add provider config (type, scopes, authType)
2. `packages/supabase/src/types.ts` — Add to `ConnectorType` and `ConnectorProvider` unions
3. `web/app/src/lib/supabase/types.ts` — Keep in sync with package types
4. `web/app/src/lib/connectors.ts` — Add to `PROVIDER_META` and `CONNECTOR_OPTIONS`

The connectors list page (`web/app/src/app/connectors/page.tsx`) renders sections dynamically — no changes needed there. The connector card also uses `PROVIDER_META` for labels/icons.

## Check-in rules

- Before every commit: update relevant docs in `/docs`
- Always write release notes for every commit
- Use **pnpm** (not npm) for all package management
- Always pass `--project` to gcloud commands, never rely on defaults

## Code style

- TypeScript: strict mode, async/await, no classes (functional style)
- SQL: PostgreSQL 15+, snake_case
- ESM: all imports use `.js` extensions in backend (TypeScript + NodeNext)
- Web app: path aliases with `@/` prefix
- All secrets via environment variables, never hardcoded
- Provider metadata (labels, icons) lives in `web/app/src/lib/connectors.ts` — don't duplicate in components

## Key files

- `SPEC.md` — Full project specification (aspirational — describes the complete vision, not just current state)
- `docs/auth.md` — Authentication architecture
- `docs/chat.md` — Chat system architecture
- `docs/connectors.md` — Connector system architecture
- `docs/deployment.md` — Deployment guide (Vercel + Cloud Run)
- `backend/src/telemetry.ts` — Langfuse tracing
- `backend/src/chat/` — Chat API (streaming, tool-use loop, Claude integration)
- `backend/src/memory/` — Memory system (embeddings, hybrid search, tools, background extraction)
- `backend/src/golf/` — Golf course lookup + Skyvern browser automation
- `backend/src/tasks/` — Unified async task system (runner, handlers, polling)
- `backend/src/connectors/` — Connector OAuth + CRUD
- `web/app/src/lib/connectors.ts` — Single source of truth for provider display metadata
- `infra/sql/` — Database migrations
