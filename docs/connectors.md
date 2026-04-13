# Connector System Architecture

## Overview

Connectors link external data sources (Gmail, Google Calendar, Google Photos) to a user's A1DE assistant. Each connector stores OAuth credentials and provides a handle for future data access.

## How it works

### Adding a connector

1. User picks a provider on `/connectors/add` (e.g., Google Photos)
2. Frontend POSTs to `POST /connectors/google/auth` with the provider type
3. Backend builds a Google OAuth consent URL with a signed JWT state token (contains userId, provider, type)
4. User authorizes on Google's consent screen
5. Google redirects to `GET /connectors/google/callback` with an auth code
6. Backend verifies the state JWT, exchanges the code for tokens, and:
   - Upserts a `connector_credentials` row (merges scopes if credential already exists)
   - Creates a `connectors` row linked to the credential
7. Redirects to `/connectors?success=true`

### Viewing connectors

The `/connectors` page queries the `connectors` table via Supabase with RLS (user sees only their own). Connectors are grouped by type (email, calendar, photos, etc.) and rendered dynamically.

### Disconnecting

DELETE request to `/connectors/:id` removes the connector row. If no other connectors share the same credential, the credential is also deleted.

## Database tables

### `connector_credentials`

Stores OAuth tokens. One row per unique Google account + provider combination. RLS is **disabled** — only the backend (service_role key) can access this table.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID | References auth.users |
| provider | TEXT | Always `google` for now |
| account_id | TEXT | Google email address |
| access_token | TEXT | Short-lived access token |
| refresh_token | TEXT | Long-lived refresh token |
| scopes | TEXT[] | Granted OAuth scopes |
| token_expires_at | TIMESTAMPTZ | When access token expires |

### `connectors`

User-facing connector instances. RLS enabled — users can read/update/delete their own.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID | References auth.users |
| credential_id | UUID | References connector_credentials |
| type | TEXT | email, calendar, photos, health |
| provider | TEXT | gmail, google_calendar, google_photos, etc. |
| label | TEXT | User-given name |
| status | TEXT | active, error, disconnected |

## Current providers

| Provider | Type | OAuth Scope |
|----------|------|-------------|
| Gmail | email | `gmail.readonly` |
| Google Calendar | calendar | `calendar.readonly` |
| Google Photos | photos | `photoslibrary.readonly` |

## Adding a new provider

See the "Adding a new connector provider" section in `CLAUDE.md` for the checklist of files to update.

## Token refresh

`google-oauth.ts` provides `getValidAccessToken(credentialId)` which checks the token expiry (with a 5-minute buffer) and refreshes via Google's token endpoint if needed. Refreshed tokens are persisted back to `connector_credentials`.

## Key files

- `backend/src/connectors/router.ts` — API routes
- `backend/src/connectors/providers.ts` — Provider registry (scopes, auth type)
- `backend/src/connectors/db.ts` — Database operations
- `backend/src/connectors/google-oauth.ts` — OAuth flow + token refresh
- `web/app/src/lib/connectors.ts` — Frontend provider metadata
- `infra/sql/002_connectors.sql` — Schema + RLS policies
