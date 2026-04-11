# A1DE

Personal family AI assistant. Organizes your life by reading email, calendar, bank transactions, and messages — then proactively helps with planning, reminders, bill tracking, and daily briefings.

## Architecture

- **Web app** — Next.js on Vercel (`app.a1de.xyz`)
- **Backend** — TypeScript (Hono) on GCP Cloud Run
- **Database** — PostgreSQL + pgvector on Supabase
- **Auth** — Supabase Auth with Google OAuth
- **Intelligence** — Claude Sonnet API with tool use
- **iOS app** — Native Swift/SwiftUI (future)
- **Channels** — iMessage (Sendblue), WhatsApp (Kapso), SMS (Twilio) (future)

## Getting started

```bash
pnpm install
pnpm dev:app      # app.a1de.xyz on localhost:3000
pnpm dev:backend  # API on localhost:8080
```

Copy `.env.local.example` → `.env.local` in `web/app/`, and `.env.example` → `.env` in `backend/`. See [docs/deployment.md](./docs/deployment.md) for full setup.

## Repo structure

```
a1de.xyz/
├── web/
│   └── app/           # Web app with user + admin routes (Next.js)
├── backend/           # TypeScript backend (Hono on Cloud Run)
├── packages/
│   └── supabase/      # Shared Supabase types
├── supabase/          # Supabase config (config.toml)
├── infra/
│   └── sql/           # Database migrations
├── docs/              # Architecture and operations docs
├── apps/ios/          # Native Swift iOS app (future)
└── design/            # Premiere v3 design system reference (future)
```

## Documentation

- [SPEC.md](./SPEC.md) — Full project specification
- [docs/auth.md](./docs/auth.md) — Authentication architecture
- [docs/deployment.md](./docs/deployment.md) — Deployment guide
