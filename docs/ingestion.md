# Ingestion System

## Overview

The ingestion system pulls structured data from connected sources (calendar, email, photos, banking) into A1DE's database so Claude can query it instantly via tools.

**Core principle**: each channel has different signal density and needs different logic. Email is filtered aggressively; calendar is preserved wholesale. One size does not fit all.

## What gets stored where

Each ingested item produces one of three outputs:

| Output | Table(s) | Retrieval |
|---|---|---|
| **Discard** | — | Never enters the system |
| **Structured record** | `events`, `bills` (TBD), `purchases` (TBD), `health_metrics`, `transactions` (TBD) | Direct SQL via tools like `get_calendar_events` |
| **Semantic memory** | `memories` + entity graph | Hybrid search via `search_memory` |

The channel's pipeline decides which bucket a given item goes into.

## Channels

### Google Calendar (implemented)

**Strategy**: ingest every event into the `events` table. No filtering — every event matters. No vectorization — we query by date range.

**Sync approach**:
- **On connect**: backfill ±1 year from now
- **Hourly tick**: Cloud Scheduler hits `/tasks/tick` → creates a `calendar.sync` task per user with an active calendar connector
- **Incremental**: uses Google Calendar's `syncToken` (stored in `connectors.sync_cursor`) — only fetches changes since last run
- **Fallback**: if the sync token has expired (>7 days), automatically re-does a full sync

**Files**:
- `backend/src/ingestion/google-calendar.ts` — API wrapper (list + paginate)
- `backend/src/ingestion/events-db.ts` — events table CRUD + connector helpers
- `backend/src/ingestion/tools.ts` — `get_calendar_events` Claude tool
- `backend/src/tasks/handlers/calendar-sync.ts` — task handler

**Memory extraction from calendar**: deferred. The structured events are what Claude queries. Future phase will extract memories from patterns (recurring events → "plays tennis Saturdays", birthdays → relationships).

### Gmail (implemented)

**Strategy**: aggressive filtering. Most email is promos, notifications, receipts. Only a small fraction deserves semantic extraction.

**Pipeline** (per email):
1. Fetch metadata only (subject + sender + snippet). Never pull full bodies.
2. Classify with Haiku, batched 20 at a time. Categories:
   - **Discard**: `promo`, `notification`, `newsletter`, `social`, `unknown`
   - **Structured**: `receipt`, `bill`, `travel`, `appointment` → events table with `source: gmail_<class>`
   - **Semantic**: `personal`, `work` → extract facts to memories table
3. For structured emails: extract date, title, vendor, amount with Haiku → upsert to events
4. For semantic emails: extract durable facts about the user with Haiku → save to memories

**Sync modes**:
- **Backfill** (on connect): last 50 days excluding promotions/spam, PLUS every message in threads the user has replied to in the last 30 days. Persists Gmail's `historyId` as the starting point for incremental.
- **Incremental** (hourly tick): `history.list` since last `historyId`. If Gmail's history has expired (~7 days), falls back to a 7-day backfill.

**Files**:
- `backend/src/ingestion/gmail.ts` — REST client
- `backend/src/ingestion/email-classifier.ts` — Haiku batch classifier
- `backend/src/ingestion/email-extractor.ts` — structured + semantic extractors
- `backend/src/tasks/handlers/email-sync.ts` — task handler

**Cost profile**: Haiku classifier is cheap (~$0.25 per 10k emails). We batch 20 at a time so a 2000-email backfill is ~100 Haiku calls total.

### Other channels (future)

- **Photos**: trip summaries only; per-photo metadata only if user cares
- **Plaid transactions**: direct to transactions table + weekly spending summaries as memories
- **Apple Health**: time-series table + daily/weekly summaries as memories

## Adding a new channel

1. Add an ingestion module under `backend/src/ingestion/<channel>.ts`
2. Define its task type in `backend/src/tasks/handlers/<channel>-sync.ts`
3. Register the handler in `backend/src/tasks/index.ts`
4. Update `backend/src/tasks/router.ts#/tick` to create sync tasks for active connectors of this channel
5. Add Claude tools in `ingestion/tools.ts` for reading the channel's structured data

## Key files

- `infra/sql/006_events.sql` — events table + sync_cursor column on connectors
- `backend/src/ingestion/` — per-channel clients and shared helpers
- `backend/src/tasks/handlers/calendar-sync.ts` — calendar sync task
- `backend/src/tasks/router.ts` — `/tasks/tick` endpoint for periodic triggers
- `docs/tasks.md` — how the task system works (used for every sync)
