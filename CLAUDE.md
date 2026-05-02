# A1DE — Claude Code Project Context

A1DE (formerly "Jarvis") is a personal family AI assistant. Monorepo with Next.js web app, TypeScript backend, and infrastructure. iOS app planned for Phase 3.

## Architecture

- **Web app:** Next.js 15 (App Router) on Vercel under the Galvyn team — `app.a1de.xyz`
- **Backend:** TypeScript + Hono on GCP Cloud Run (project: `a1de-assistant`)
- **Database:** PostgreSQL + pgvector on Supabase (project ref: `erwowjlaakatqsvuppzj`, region: us-west-1)
- **Intelligence:** Claude Sonnet 4.5 API (streaming chat implemented, tool use coming next)
- **Telemetry:** Langfuse via OpenTelemetry (traces all Claude calls with user/session context)
- **Design system:** [@galvyn-io/design](https://www.npmjs.com/package/@galvyn-io/design) — dark-first monotone with surgical accent. Accent hue set to `180` (teal). Components: Button, Card, Badge, Input, FilterToggle, Kbd, GradientBorder.

## Current state (Phase 1 mostly complete)

**What's built:**
- Google OAuth login + registration flow (Supabase Auth)
- Admin dashboard (user list, admin-only access)
- Connector system: OAuth flow to connect Gmail, Google Calendar, Google Photos
- Connector management UI (add, view, disconnect)
- Backend API: connector CRUD + Google OAuth token exchange/refresh
- Chat system: agent runs server-side via the `chat.respond` task; live token streaming over Supabase realtime broadcast; final messages persisted to DB so closing the tab mid-response doesn't lose the answer
- Chat UI: conversation sidebar, message bubbles, live broadcast subscription, tool status display
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

- Google Calendar ingestion: events table, hourly incremental sync, `get_calendar_events` tool
- Gmail ingestion: aggressive Haiku classifier (batches of 20), route to discard/structured (events table) / semantic (memory extraction). Backfill 50 days + replies, hourly incremental via Gmail history API.

- Whoop connector: OAuth2 flow, hourly sync of recovery / sleep / strain / workouts into `health_metrics`. Backfills 30 days on connect; incremental thereafter via per-connector cursor.

**What's NOT built yet:**
- Connector ingestion (Gmail/Calendar → memories)
- Apple Health connector (waits on iOS app)
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
    │   ├── router.ts         # POST /chat (enqueues chat.respond task), conversation CRUD
    │   ├── db.ts             # Conversation + message persistence
    │   └── claude.ts         # buildSystemPrompt + buildMessages (history → Anthropic format)
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
    ├── health/
    │   ├── whoop.ts          # Whoop API client + pure mappers to health_metrics rows
    │   ├── db.ts             # upsertHealthMetrics, getRecentHealthMetrics
    │   └── tools.ts          # get_recent_health_metrics tool definition + executor
    ├── webhooks/
    │   └── whoop.ts          # POST /webhooks/whoop — HMAC-verified, schedules whoop.sync
    ├── realtime.ts            # Stateless REST broadcasts to Supabase Realtime
    └── tasks/
        ├── types.ts          # TaskHandler interface, TaskRow type
        ├── registry.ts       # Handler registration
        ├── runner.ts         # createTask, runTask, pollRunningTasks
        ├── db.ts             # Supabase CRUD for tasks
        ├── router.ts         # GET /tasks, GET /tasks/:id, POST /tasks/poll
        ├── chat-notifier.ts  # Append task results to a chat conversation
        ├── index.ts          # registerAllHandlers() — call once at startup
        └── handlers/         # One file per task type
            ├── chat-respond.ts   # Agent loop: streaming + tool use + persistence
            ├── memory-extract.ts
            ├── calendar-sync.ts
            ├── email-sync.ts
            ├── whoop-sync.ts     # Pulls Whoop recovery/sleep/strain → health_metrics
            └── golf.ts

web/app/
├── src/
│   ├── app/
│   │   ├── layout.tsx        # Root layout (Outfit font, dark mode)
│   │   ├── page.tsx          # Redirect to login/dashboard
│   │   ├── login/            # Google OAuth login
│   │   ├── register/         # Choose assistant name
│   │   ├── dashboard/        # Protected dashboard
│   │   ├── chat/             # Chat UI (streaming, conversation sidebar, realtime messages)
│   │   ├── memories/         # Memory browser (list/delete facts, entities, relations)
│   │   ├── insights/         # "What's new" activity dashboard (last 7 days, by source)
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
├── 005_tasks.sql             # tasks table + realtime publication
└── 006_events.sql            # events table + connector sync_cursor column

docs/
├── auth.md                   # Authentication architecture
├── chat.md                   # Chat as a task: streaming, broadcast, disconnect resilience
├── connectors.md             # Connector system architecture
├── deployment.md             # Vercel + Cloud Run + Vertex AI + Cloud Scheduler
├── ingestion.md              # Per-channel data ingestion strategy
├── memory.md                 # Memory system (knowledge graph, hybrid search, tools)
├── tasks.md                  # Unified async task system
└── testing.md                # vitest setup, CI gates, what's covered

.github/workflows/
└── ci.yml                    # Typecheck + tests on push/PR (must pass before deploy)
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
- Run `pnpm -F @a1de/backend typecheck && pnpm -F @a1de/backend test` before pushing — CI runs the same checks and a red gate blocks the deploy mental model

## Code style

- TypeScript: strict mode, async/await, no classes (functional style)
- SQL: PostgreSQL 15+, snake_case
- ESM: all imports use `.js` extensions in backend (TypeScript + NodeNext)
- Web app: path aliases with `@/` prefix
- All secrets via environment variables, never hardcoded
- Provider metadata (labels, icons) lives in `web/app/src/lib/connectors.ts` — don't duplicate in components
- **UI**: use `@galvyn-io/design` components and semantic Tailwind tokens (`bg-bg`, `text-fg`, `border-border`, `text-fg-muted`, etc.) instead of raw zinc-* colors. Tokens are defined in `globals.css` via `@theme` mapping galvyn CSS variables to Tailwind utilities.
- **Cmd+K command palette** is mounted globally in `app/layout.tsx` via `web/app/src/components/command-palette.tsx`

## Key files

- `SPEC.md` — Full project specification (aspirational — describes the complete vision, not just current state)
- `docs/auth.md` — Authentication architecture
- `docs/chat.md` — Chat system architecture
- `docs/connectors.md` — Connector system architecture
- `docs/deployment.md` — Deployment guide (Vercel + Cloud Run)
- `backend/src/telemetry.ts` — Langfuse tracing
- `backend/src/chat/` — Chat HTTP routes + system prompt / message builders
- `backend/src/tasks/handlers/chat-respond.ts` — Agent loop (streaming, tool use, persistence)
- `backend/src/memory/` — Memory system (embeddings, hybrid search, tools, background extraction)
- `backend/src/golf/` — Golf course lookup + Skyvern browser automation
- `backend/src/tasks/` — Unified async task system (runner, handlers, polling)
- `backend/src/connectors/` — Connector OAuth + CRUD
- `web/app/src/lib/connectors.ts` — Single source of truth for provider display metadata
- `infra/sql/` — Database migrations
