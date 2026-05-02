# Testing

A1DE uses **vitest** for backend tests. Tests live next to the source they cover (`src/foo.ts` → `src/foo.test.ts`) and run on every push and PR via GitHub Actions.

## Running tests locally

```bash
# Backend tests + typecheck
pnpm -F @a1de/backend test
pnpm -F @a1de/backend typecheck

# Watch mode while developing
pnpm -F @a1de/backend test:watch
```

The `build` script (`tsc -p tsconfig.build.json`) excludes `*.test.ts` from production output. The `typecheck` script (`tsc --noEmit`) covers everything including tests, so type errors in test code break CI.

## Test structure

- **Unit tests for pure logic** — `chat/claude.test.ts` exercises `buildMessages` and `buildSystemPrompt` directly with handcrafted message rows. No mocks needed.
- **Handler tests with module mocks** — `tasks/handlers/chat-respond.test.ts` mocks `@anthropic-ai/sdk`, `@supabase/supabase-js`, the chat/db and memory/db modules, and the task runner. The mocks document the dependency surface; assertions check what gets persisted and what gets broadcast.

The chat-respond handler is the highest-leverage place to test since the agent loop drives every chat turn. The four scenarios covered:

1. **Single end_turn turn** — verifies token deltas broadcast and the final assistant message is persisted.
2. **tool_use → end_turn** — verifies the tool-call assistant message and tool-result message are persisted with `parent_message_id` linkage, and `tool_call` broadcasts fire.
3. **Realtime subscribe failure** — verifies the agent still completes and persists the final message even when the broadcast channel fails to subscribe (this is the "close the tab, come back, see the answer" guarantee).
4. **MAX_TOOL_ITERATIONS cap** — verifies the loop bails after 5 iterations even if the model keeps returning `tool_use`.

## CI

`.github/workflows/ci.yml` runs on push to `main` and on every PR:

1. `pnpm install --frozen-lockfile`
2. `pnpm -F @a1de/backend typecheck`
3. `pnpm -F @a1de/backend test`

A red CI gate is the signal not to deploy. The Cloud Run deploy command (`gcloud run deploy a1de-backend --source backend ...`) and Vercel auto-deploy both run after merge to `main`; if CI failed on the merge commit, fix-forward before redeploying.

## What's not covered yet

- **Frontend tests** — React components are not tested in this repo. Major UI changes still require manual smoke testing on `app.a1de.xyz`.
- **Integration / end-to-end tests** — no live Supabase or Anthropic calls in CI. Mocks cover the handler boundaries; the full Cloud Run + Supabase stack is exercised manually.
- **Tool dispatch** — the memory / golf / ingestion tool implementations have only their pure helpers tested. Anything that calls an external API is exercised manually after deploy.

These are deliberate gaps — vitest unit tests give us the fast, deterministic safety net needed to refactor the agent loop, and the manual smoke pass after deploy catches the rest. Adding React Testing Library or a Playwright e2e setup is a follow-up if/when the cost of manual testing grows.

## Adding a test

1. Put it next to the source: `src/path/to/foo.test.ts`.
2. Use `vi.mock(...)` at the top of the file to stub external modules. Keep mocks minimal — return only what the test under inspection needs.
3. Prefer assertions on observable behavior (what got persisted, what got broadcast) over implementation details (which internal helper got called).
