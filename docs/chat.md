# Chat Architecture

## Overview

The chat system lets users converse with their AI assistant (Claude Sonnet) through a web UI. Messages are streamed via SSE for responsive UX. Conversations and messages are persisted in Supabase with per-user RLS.

## How it works

### Sending a message

1. User types message in `/chat` and hits Send
2. Frontend POSTs to `POST /chat` with `{ conversation_id?, message }` and Bearer token
3. Backend creates conversation if needed, saves user message to DB
4. Returns `{ conversation_id, message_id }`
5. Frontend opens SSE stream via `GET /chat/stream?conversation_id=...`
6. Backend loads conversation history, builds Claude request with system prompt
7. Streams Claude's response as `data: {"delta":"..."}` SSE events
8. On completion, saves assistant message to DB, sends `data: {"done":true,"message_id":"..."}`

### System prompt

Currently a simple template:
```
You are {assistant_name}, a personal AI assistant for {user_name}.
Today is {date}.
Be helpful, concise, and warm.
```

Will be expanded when the memory system is built to include relevant memories, connector data, etc.

## Database tables

### `conversations`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID | References auth.users |
| title | TEXT | Nullable, for future auto-titling |
| created_at | TIMESTAMPTZ | Auto-set |
| updated_at | TIMESTAMPTZ | Updated on new messages via `touchConversation` |

### `messages`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| conversation_id | UUID | References conversations |
| user_id | UUID | Denormalized for RLS (avoids join-based policy) |
| role | TEXT | `user`, `assistant`, or `tool` |
| content | TEXT | Message text |
| tool_calls | JSONB | For future tool use |
| tool_result | JSONB | For future tool results |
| model | TEXT | Claude model used (assistant messages only) |
| created_at | TIMESTAMPTZ | Auto-set |

RLS: users can SELECT/INSERT their own rows. Admins can SELECT all.

## API endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /chat | Bearer | Send message, create conversation if needed |
| GET | /chat/stream | Bearer | SSE stream of Claude's response |
| GET | /chat/conversations | Bearer | List user's conversations |
| GET | /chat/conversations/:id/messages | Bearer | Get messages for a conversation |

## Frontend

- `/chat` — Main chat interface. Three columns: left = conversation sidebar, middle = messages, right = "Now" panel (active tasks + recent memories, toggled with ⌘.)
- `/chat/[id]` — Deep link to specific conversation
- Streaming via `fetch` + `ReadableStream` (supports auth headers, unlike `EventSource`)
- Realtime: subscribes to Supabase Postgres changes on `messages` for the active conversation, so task-generated messages appear live
- ⌘K opens a global command palette (see `web/app/src/components/command-palette.tsx`)

## Tools available to Claude

Defined in `backend/src/chat/router.ts`'s `ALL_TOOLS`:

| Tool | Purpose |
|---|---|
| `search_memory` | Hybrid vector + full-text search over the user's knowledge graph |
| `save_fact` | Explicitly save a fact or preference |
| `search_golf_courses` | Find courses via GolfCourseAPI |
| `check_tee_times_at_course` | Start a Skyvern task to scrape a course's booking site |
| `book_tee_time` | Start a Skyvern task to book a specific tee time |
| `check_task_status` | Get the status/result of any background task by task_id |
| `web_search` | Anthropic's native web search (real-time info) |

## Telemetry

Every Claude API call is automatically traced via Langfuse + OpenTelemetry (configured in `backend/src/telemetry.ts`). Each chat stream is tagged with `userId` and `sessionId` (conversation ID) via `propagateAttributes()` in the router, so traces in Langfuse show which user and conversation generated them.

Dashboard: https://us.cloud.langfuse.com

## Key files

- `backend/src/chat/router.ts` — API routes
- `backend/src/chat/db.ts` — Database operations
- `backend/src/chat/claude.ts` — Claude API wrapper + system prompt
- `backend/src/telemetry.ts` — Langfuse + OpenTelemetry setup
- `web/app/src/app/chat/chat-interface.tsx` — Client component (messages, input, streaming)
- `infra/sql/003_conversations.sql` — Schema + RLS policies

## Future: Memory system integration

The messages table is designed to support the memory system:
- `user_id` on messages enables direct memory queries per user
- `embedding vector(1536)` column will be added in a future migration
- `memories` table will reference `source_message_id` for traceability
