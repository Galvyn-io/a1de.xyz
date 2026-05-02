# Chat Architecture

## Overview

Chat is the primary interaction surface for A1DE. The user sends a message, the agent runs server-side via the unified task system, and the response streams back over Supabase realtime — token-by-token while the agent is generating, and as a persisted message row when it's done. Conversations and messages live in Supabase with per-user RLS.

The agent loop runs as a `chat.respond` task. This means the agent finishes whether or not the client stays connected: close the browser mid-response and the answer is waiting for you when you come back.

## How it works

### Sending a message

1. User types in `/chat` and hits Send.
2. Frontend POSTs `POST /chat` with `{ conversation_id?, message }` and Bearer token.
3. Backend:
   - Creates a conversation if `conversation_id` was omitted.
   - Saves the user message to `messages`.
   - Auto-titles the conversation from the first message (truncated to 60 chars).
   - **Creates a `chat.respond` task** linked to the conversation and returns `{ conversation_id, message_id, task_id }`.
4. The `chat.respond` task handler runs the agent loop server-side. It:
   - Loads conversation history + always-inject memories + user profile.
   - Subscribes to a Supabase realtime broadcast channel `chat:{conversationId}`.
   - Calls `client.messages.stream()` (real token streaming) with the full tool set.
   - Pipes `text` deltas into ~80ms broadcast batches → frontend sees live tokens.
   - On `tool_use`: persists an assistant message (with `tool_calls`) and one tool-result message per tool, broadcasts a `tool_call` event for each, then continues the loop.
   - On `end_turn`: saves the final assistant message to `messages` and broadcasts `done`.
   - Caps at `MAX_TOOL_ITERATIONS = 5` to prevent runaway loops.
   - Triggers a `memory.extract` task on completion (background fact extraction).

### What the frontend subscribes to

Two realtime subscriptions per active conversation:

1. **`postgres_changes` on `messages`** — every persisted message INSERT (user, assistant, tool, including tool-call assistant messages and final assistant messages). Dedup is by message id.
2. **`broadcast` on `chat:{conversationId}`** — ephemeral events:
   - `delta` `{ text }` — append to live streaming bubble.
   - `tool_call` `{ name, input }` — show "Searching memory..." style indicator and reset the live bubble (its text has been persisted as an assistant tool-call message that will arrive via `postgres_changes`).
   - `done` `{ message_id }` — clear streaming state.
   - `error` `{ error }` — show error.

### What happens if the client disconnects

The agent loop is a Cloud Run task, not an HTTP request. If the user closes the tab, navigates away, or loses connectivity:

- The task keeps running on the server.
- All messages still get persisted to `messages` as the loop progresses.
- When the client reconnects (refresh, reopen tab, switch device), the existing `postgres_changes` subscription replays the conversation state by loading from DB; live broadcasts only resume for whatever's still in-flight.

The broadcast channel is fire-and-forget on the server. If subscribe fails or send fails, the agent loop continues — the source of truth is the DB row, not the broadcast.

## System prompt

Built dynamically by `buildSystemPrompt(...)` in `chat/claude.ts` with the assistant name, user name, today's date, the tool-use guide, and an "What you know about {user}" section populated from always-inject memories.

## Database tables

### `conversations`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID | References auth.users |
| title | TEXT | Nullable; auto-set from the first user message |
| created_at | TIMESTAMPTZ | Auto-set |
| updated_at | TIMESTAMPTZ | Bumped after each turn via `touchConversation` |

### `messages`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| conversation_id | UUID | References `conversations` |
| user_id | UUID | Denormalized for RLS |
| role | TEXT | `user`, `assistant`, or `tool` |
| content | TEXT | Message text (nullable when only tool_calls/tool_result) |
| tool_calls | JSONB | Anthropic-format tool_use blocks (assistant turns) |
| tool_result | JSONB | `{ tool_use_id, content }` (tool turns) |
| parent_message_id | UUID | Tool messages reference the assistant message that produced the tool call |
| model | TEXT | Claude model used (assistant messages only) |
| created_at | TIMESTAMPTZ | Auto-set |

RLS: users can SELECT/INSERT their own rows. Admins can SELECT all.

## API endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/chat` | Bearer | Save user message, enqueue `chat.respond` task. Returns `{ conversation_id, message_id, task_id }`. |
| GET | `/chat/conversations` | Bearer | List user's conversations |
| GET | `/chat/conversations/:id/messages` | Bearer | Load full message history |
| PATCH | `/chat/conversations/:id` | Bearer | Rename a conversation |
| DELETE | `/chat/conversations/:id` | Bearer | Delete a conversation |

The old `GET /chat/stream` SSE endpoint was removed when chat moved to the task system. Live streaming now flows through Supabase realtime broadcast.

## Frontend

- `/chat` — Main interface. Three columns: left = conversation sidebar, middle = messages, right = "Now" panel (active tasks + recent memories, toggled with ⌘.).
- `/chat/[id]` — Deep link to a conversation.
- ⌘K opens the global command palette (`web/app/src/components/command-palette.tsx`).

## Tools available to Claude

Registered in `backend/src/tasks/handlers/chat-respond.ts`'s `ALL_TOOLS`:

| Tool | Purpose |
|---|---|
| `search_memory` | Hybrid vector + full-text search over the user's knowledge graph |
| `save_fact` | Explicitly save a fact or preference |
| `get_calendar_events` | Query the user's synced Google Calendar |
| `search_golf_courses` | Find courses via GolfCourseAPI |
| `check_tee_times_at_course` | Start a Skyvern task to scrape a course's booking site |
| `book_tee_time` | Start a Skyvern task to book a specific tee time |
| `check_task_status` | Get the status/result of any background task by task_id |
| `web_search` | Anthropic's native web search (real-time info) |

## Telemetry

Every Claude API call is wrapped in a Langfuse trace inside `chat-respond.ts` — one trace per chat turn, one `generation` span per Claude `messages.stream()` call (one per tool-use iteration). Tagged with `userId` and `sessionId` (conversation ID).

Dashboard: https://us.cloud.langfuse.com

## Key files

- `backend/src/chat/router.ts` — API routes (POST `/chat`, conversation CRUD)
- `backend/src/chat/db.ts` — Database operations
- `backend/src/chat/claude.ts` — `buildSystemPrompt`, `buildMessages` (history → Anthropic format)
- `backend/src/tasks/handlers/chat-respond.ts` — Agent loop, streaming, tool dispatch
- `backend/src/telemetry.ts` — Langfuse setup
- `web/app/src/app/chat/chat-interface.tsx` — Client component (messages, input, realtime subscriptions)
- `infra/sql/003_conversations.sql` — Schema + RLS policies

## Tests

- `backend/src/chat/claude.test.ts` — `buildMessages` and `buildSystemPrompt` unit tests.
- `backend/src/tasks/handlers/chat-respond.test.ts` — Handler tests with mocked Anthropic + Supabase: end_turn happy path, tool_use → end_turn, disconnect resilience (subscribe fails, message still persists), MAX_TOOL_ITERATIONS cap.

Run: `pnpm -F @a1de/backend test`. CI runs them on every push and PR.
