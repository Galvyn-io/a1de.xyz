# Task System

## Overview

A1DE's task system is a unified async-job infrastructure. **Every async or scheduled operation** — golf booking, memory extraction, connector syncs, LLM summaries, cron reminders — flows through the same pipeline.

Goals:
- **Durability** — tasks survive restarts (state is in Supabase, not in-memory)
- **Observability** — users see every task in one place at `/tasks`
- **Freedom** — users can close the page; tasks keep running, results appear automatically
- **Composability** — any new async feature is just a new handler

## How it works

```
Tool / scheduler / webhook
        │
        ▼
   createTask()  ──────► tasks row (status: pending)
        │
        ▼
   runTask()     ──────► handler.run()
        │                    │
        │                    ├── Sync task: returns { status, output } → done
        │                    └── Async task: returns { external_id, provider }
        │                                     │
        │                                     ▼
        │                            tasks row (status: running)
        │                                     │
        ▼                                     ▼
   Cloud Scheduler polls every minute ──► handler.poll() updates status
        │
        ▼
   Task completes (status: completed | failed)
        │
        ▼
   handler.onComplete() / onFailed()
        │
        ├── Save to memory
        ├── Append to conversation
        └── Trigger follow-up tasks

   Supabase realtime pushes status changes → /tasks page and chat update live
```

## Schema (`infra/sql/005_tasks.sql`)

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | PK |
| user_id | UUID | Owner (RLS) |
| type | TEXT | `golf.search`, `memory.extract`, etc. |
| status | TEXT | `pending` / `running` / `completed` / `failed` / `cancelled` |
| input | JSONB | Handler input |
| output | JSONB | Handler result |
| error | TEXT | Failure message |
| external_provider | TEXT | `skyvern`, `anthropic`, etc. |
| external_id | TEXT | Their ID (for polling/webhooks) |
| progress_message | TEXT | Human-readable current step |
| progress_pct | INT | 0-100 if known |
| conversation_id | UUID | Optional: chat that spawned it |
| schedule_id | UUID | Optional: recurring schedule that created it |
| parent_task_id | UUID | For task chains |
| scheduled_for | TIMESTAMPTZ | Delayed execution |

RLS: users see their own tasks. Supabase realtime is enabled on the `tasks` table so the UI updates live.

## Adding a new task type

Create a handler that implements the `TaskHandler` interface:

```ts
// backend/src/tasks/handlers/my-task.ts
export const myTaskHandler: TaskHandler = {
  type: 'my.task',
  provider: 'some_service',  // optional, for webhook routing

  async run(task) {
    // Start the work. For async jobs, kick off the external call and
    // return { external_id }. For sync jobs, do the work and return
    // { status: 'completed', output: {...} }.
  },

  async poll(task) {
    // For async jobs, check external service status
    return { status: 'running' | 'completed' | 'failed', output, error };
  },

  async onComplete(task) {
    // Side effects: save to memory, append to chat, trigger follow-ups
  },

  async onFailed(task) { /* optional */ },
};
```

Then register it in `backend/src/tasks/index.ts`:

```ts
import { myTaskHandler } from './handlers/my-task.js';

export function registerAllHandlers() {
  // ...existing...
  registerHandler(myTaskHandler);
}
```

Create tasks via `createTask()` from anywhere in the codebase:

```ts
import { createTask } from '../tasks/index.js';

await createTask({
  userId,
  type: 'my.task',
  input: { foo: 'bar' },
  conversationId, // optional — if set, onComplete can post to the chat
});
```

## Polling worker

A Cloud Scheduler job (`a1de-task-poller`) hits `POST /tasks/poll` every minute. The endpoint finds all tasks with `status='running'` that haven't been updated in the last 30 seconds, and calls each handler's `poll()` to advance them.

- **Auth:** `X-Poll-Secret` header, value is `TASK_POLL_SECRET` env var
- **Schedule:** `* * * * *` (every minute) in `us-west1`
- **Deadline:** 90 seconds

When webhooks become available for a provider, we can add them without removing polling — polling acts as the fallback.

## Existing task types

| Type | Provider | Trigger | Purpose |
|---|---|---|---|
| `chat.respond` | anthropic | `POST /chat` | Run the agent loop for a user message — streaming, tool use, persistence |
| `memory.extract` | anthropic | after each chat | Extract facts from a conversation turn |
| `calendar.sync` | google | hourly tick + on connect + manual refresh | Pull Google Calendar events into the `events` table |
| `email.sync` | google | hourly tick + on connect + manual refresh | Pull Gmail messages, classify, route to discard / structured / semantic |
| `golf.search` | skyvern | chat | Check tee time availability at a course |
| `golf.book` | skyvern | chat | Book a specific tee time |

## UI

- `/tasks` — dashboard showing all tasks with live status updates via Supabase realtime
- Filters: Active, Recent (24h), All
- Each task shows: type, input summary, status, progress, duration, link to originating chat

When a task completes with `conversation_id`, the handler posts a message to the chat via `appendSystemMessageToConversation()`. The frontend (chat-interface.tsx) is subscribed to `messages` table realtime updates on the active conversation, so the message appears live without refresh.

The `chat.respond` handler is special: it doesn't just append on completion — it persists tool-call assistant messages and tool-result messages incrementally as the agent loop progresses, and also broadcasts live token deltas on the realtime channel `chat:{conversationId}` while streaming. This lets the chat UI show real-time token-by-token output while the agent runs server-side, even if the client disconnects mid-response.

## Key files

- `backend/src/tasks/types.ts` — `TaskHandler`, `TaskRow` types
- `backend/src/tasks/registry.ts` — Handler registration
- `backend/src/tasks/runner.ts` — `createTask`, `runTask`, `pollRunningTasks`
- `backend/src/tasks/db.ts` — Supabase CRUD
- `backend/src/tasks/router.ts` — `/tasks` HTTP endpoints
- `backend/src/tasks/chat-notifier.ts` — Helper to append messages to a conversation
- `backend/src/tasks/handlers/*.ts` — Individual task type implementations
- `web/app/src/app/tasks/` — UI (list, filter, realtime subscription)
- `infra/sql/005_tasks.sql` — Schema + indexes + realtime enablement

## Future work

- **Webhooks** — `/webhooks/skyvern`, `/webhooks/plaid` etc. to get push updates instead of polling
- **Scheduled tasks** — wire up the `schedules` table so cron expressions spawn tasks (e.g. "every Monday 8am → `digest.weekly`")
- **Task chains** — use `parent_task_id` for multi-step workflows ("book tee time → create calendar event → notify group chat")
- **Cancel / retry** — UI actions on the `/tasks` page
- **Notifications** — on-task-complete push notifications once the iOS app exists
