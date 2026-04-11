# Authentication Architecture

## Overview

A1DE uses **Supabase Auth** with Google OAuth for user authentication. The frontend talks directly to Supabase — the backend only verifies JWTs for API calls.

## How it works

1. User clicks "Continue with Google" on `app.a1de.xyz/login`
2. Supabase redirects to Google's OAuth consent screen
3. Google redirects back to Supabase (`erwowjlaakatqsvuppzj.supabase.co/auth/v1/callback`)
4. Supabase redirects to `app.a1de.xyz/auth/callback` with an auth code
5. The callback route handler exchanges the code for a session
6. Session cookies are set automatically via `@supabase/ssr`

## Database

### `user_profiles` table

Created by `infra/sql/001_user_profiles.sql`. Linked to `auth.users` via foreign key.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | References auth.users(id) |
| email | TEXT | User's email |
| assistant_name | TEXT | Name chosen during registration |
| is_registered | BOOLEAN | Whether registration is complete |
| is_admin | BOOLEAN | Admin access flag |
| created_at | TIMESTAMPTZ | Auto-set on creation |
| updated_at | TIMESTAMPTZ | Auto-updated on changes |

### Trigger: `on_auth_user_created`

Automatically creates a `user_profiles` row when a new user signs up. Sets `is_admin = true` for `yatharth@mlv.io`.

### RLS Policies

- Users can read and update their own profile
- Admins (`is_admin = true`) can read all profiles

## Registration flow

After first login, users are redirected to `/register` where they choose a name for their assistant. This sets `assistant_name` and `is_registered = true` on their profile.

## Admin access

The `/admin` route is protected server-side — it checks `is_admin` on the user's profile and redirects non-admins to `/dashboard`. Currently only `yatharth@mlv.io` is auto-granted admin via the database trigger.

## Supabase configuration

Auth config is managed via `supabase/config.toml` and pushed with `supabase config push`. Google OAuth credentials are passed via environment variables (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`).

Current settings:
- Site URL: `https://app.a1de.xyz`
- Redirect URLs: `https://app.a1de.xyz/auth/callback`, `http://localhost:3000/auth/callback`
- Google OAuth: enabled

## GCP OAuth setup

In the GCP Console for project `a1de-assistant`:
- OAuth 2.0 Client ID: Web application, name "A1DE Web"
- Authorized redirect URI: `https://erwowjlaakatqsvuppzj.supabase.co/auth/v1/callback`

## Backend JWT verification

The Hono backend verifies Supabase JWTs via `backend/src/middleware/auth.ts`. It extracts the Bearer token from the Authorization header and calls `supabase.auth.getUser()` to validate it.
