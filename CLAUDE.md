# A1DE — Claude Code Project Context

A1DE (formerly "Jarvis") is a personal family AI assistant. Monorepo with Swift iOS app, TypeScript backend, and infrastructure.

## Architecture

- **Backend:** TypeScript + Hono on GCP Cloud Run (project: `a1de-assistant`)
- **Database:** PostgreSQL + pgvector on Supabase (project ref: `erwowjlaakatqsvuppzj`, region: us-west-1)
- **Intelligence:** Claude Sonnet API with tool use
- **iOS app:** Native Swift/SwiftUI (not Expo/React Native)
- **Channels:** Sendblue (iMessage), Kapso (WhatsApp), Twilio (SMS)
- **Design system:** Premiere v3 — Outfit font, zinc-black dark-first, 12px radii, 1.5px strokes

## Current phase

Phase 1: REST API + Gmail reading + Claude reasoning. No messaging channels yet.

### Approved implementation plan

Build a Hono server with a single `POST /chat` endpoint that:
1. Loads conversation history from Supabase
2. Assembles context (system prompt + history + tools)
3. Calls Claude Sonnet with `search_email` tool
4. Executes Gmail API tool calls in a loop (max 10 iterations)
5. Saves conversation and returns response

**File tree (Phase 1):**
```
backend/
├── package.json              # pnpm, ESM, TypeScript
├── tsconfig.json             # strict, NodeNext
├── .env.example
├── Dockerfile                # multi-stage, node:22-slim
├── src/
│   ├── config.ts             # zod-validated env vars
│   ├── index.ts              # Hono + @hono/node-server, port 8080
│   ├── channels/
│   │   └── app-api.ts        # POST /chat endpoint
│   ├── orchestrator/
│   │   ├── context-assembly.ts  # build Claude request
│   │   └── claude.ts            # tool-use loop
│   ├── tools/
│   │   ├── registry.ts       # TOOL_DEFINITIONS + executeTool dispatcher
│   │   └── email.ts          # search_email → Gmail API
│   ├── context/
│   │   ├── db.ts             # Supabase client singleton
│   │   └── conversation.ts   # load/save conversation as JSONB
│   ├── identity/
│   │   └── a1de.ts           # A1DE system prompt template
│   └── auth/
│       └── google-oauth.ts   # OAuth2 client, auto-refresh, persist tokens to DB
└── infra/
    └── sql/
        └── schema.sql        # conversations + oauth_tokens tables
```

**Dependencies:** hono, @hono/node-server, @anthropic-ai/sdk, @supabase/supabase-js, googleapis, zod. Dev: typescript, tsx, @types/node.

**Build order:**
1. Scaffold (package.json, tsconfig, pnpm install)
2. config.ts → index.ts + app-api.ts stub → verify with curl
3. db.ts → schema.sql on Supabase → conversation.ts
4. a1de.ts → context-assembly.ts → claude.ts (no tools) → test chat
5. google-oauth.ts → email.ts + registry.ts → test email tool use
6. Dockerfile → Cloud Run deploy

**Google OAuth:** One-time manual setup via OAuth Playground for refresh token, backend auto-refreshes thereafter.

## Check-in rules

- Before every commit: update relevant architecture/usage docs in `/docs`
- Always write release notes for every commit
- Use **pnpm** (not npm) for all backend package management

## Code style

- TypeScript: strict mode, async/await, no classes (functional style)
- Swift: SwiftUI, MVVM, async/await, no UIKit unless necessary
- SQL: PostgreSQL 15+, snake_case, use pgvector for embeddings
- ESM: all imports use `.js` extensions (TypeScript + NodeNext requirement)
- All secrets via environment variables, never hardcoded

## Key files

- `SPEC.md` — Full 13-section project specification
- `backend/src/orchestrator/` — Claude API client + tool-use loop
- `backend/src/tools/` — Tool implementations Claude calls
- `backend/src/context/` — Supabase client + conversation history
- `backend/src/auth/` — Google OAuth token management
- `apps/ios/A1DE/Design/` — Premiere v3 tokens (Phase 3)
- `infra/sql/schema.sql` — Database schema
