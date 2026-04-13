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
- Chat UI: conversation sidebar, message bubbles, streaming display
- Langfuse telemetry: automatic tracing of all Claude API calls with token usage, latency, cost
- Backend deployed to Cloud Run (`a1de-backend` in `us-west1`)
- Database: `user_profiles`, `connectors`, `connector_credentials`, `conversations`, `messages` tables with RLS

**What's NOT built yet:**
- Memory system (embeddings, semantic retrieval, memory persistence)
- Tool use loop (connecting Claude to Gmail/Calendar/Photos data via tools)
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
    └── chat/
        ├── router.ts         # POST /chat, GET /stream (SSE), conversations
        ├── db.ts             # Conversation + message persistence
        └── claude.ts         # Claude API wrapper, system prompt

web/app/
├── src/
│   ├── app/
│   │   ├── layout.tsx        # Root layout (Outfit font, dark mode)
│   │   ├── page.tsx          # Redirect to login/dashboard
│   │   ├── login/            # Google OAuth login
│   │   ├── register/         # Choose assistant name
│   │   ├── dashboard/        # Protected dashboard
│   │   ├── chat/             # Chat UI (streaming, conversation sidebar)
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
└── 003_conversations.sql     # conversations + messages tables, RLS

docs/
├── auth.md                   # Authentication architecture
├── chat.md                   # Chat system architecture
├── connectors.md             # Connector system architecture
└── deployment.md             # Vercel + Cloud Run deployment
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
- `backend/src/telemetry.ts` — Langfuse + OpenTelemetry instrumentation
- `backend/src/chat/` — Chat API (streaming, Claude integration)
- `backend/src/connectors/` — Connector OAuth + CRUD
- `web/app/src/lib/connectors.ts` — Single source of truth for provider display metadata
- `infra/sql/` — Database migrations
