# A1DE

Personal family AI assistant. Organizes your life by reading email, calendar, bank transactions, and messages — then proactively helps with planning, reminders, bill tracking, and daily briefings.

## Architecture

- **iOS app** — Native Swift/SwiftUI with Premiere v3 design system
- **Backend** — TypeScript (Hono) on GCP Cloud Run
- **Database** — PostgreSQL + pgvector on Cloud SQL
- **Intelligence** — Claude Sonnet API with tool use
- **Channels** — iMessage (Sendblue), WhatsApp (Kapso), SMS (Twilio)

## Getting started

See [SPEC.md](./SPEC.md) for the full project specification, architecture, and build phases.

## Repo structure

```
a1de.xyz/
├── apps/ios/          # Native Swift iOS app
├── backend/           # TypeScript backend (Hono on Cloud Run)
├── infra/             # Terraform, Dockerfile, SQL schema
├── edge/              # Home edge scripts (Mac Studio, red-nuc)
├── design/            # Premiere v3 design system reference
└── docs/              # Architecture and operations docs
```
