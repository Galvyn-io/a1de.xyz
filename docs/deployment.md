# Deployment

## Web app (Vercel)

Deploys to Vercel under the **Galvyn** team as a single Next.js app serving both user and admin routes.

- **Project:** `a1de-app` (Vercel project ID: `prj_1bgeRADOmVCRonDIPT8pp3GQHaOH`)
- **URL:** `app.a1de.xyz`
- **Framework:** Next.js 15
- **Root Directory:** `web/app`

### Git integration

The Vercel project is connected to `Galvyn-io/a1de.xyz` on GitHub. Pushes to `main` should trigger auto-deploys. If auto-deploy stops working, deploy manually:

```bash
# From the repo root (not web/app — Vercel applies root directory setting)
vercel deploy --prod
```

### Environment variables

- `NEXT_PUBLIC_SUPABASE_URL` = `https://erwowjlaakatqsvuppzj.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = (from Supabase dashboard)
- `NEXT_PUBLIC_BACKEND_URL` = (Cloud Run URL, once deployed)

### pnpm workspace note

Vercel detects `pnpm-workspace.yaml` at the repo root and installs dependencies for the full workspace. The `Root Directory` setting tells Vercel which package to build.

## Backend (Cloud Run)

Not deployed yet. When ready:

1. Build Docker image from root `Dockerfile` (not `backend/Dockerfile`)
2. Push to GCR in project `a1de-assistant` (always pass `--project a1de-assistant` to gcloud)
3. Deploy to Cloud Run with environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `GOOGLE_OAUTH_CLIENT_ID`
   - `GOOGLE_OAUTH_CLIENT_SECRET`
   - `OAUTH_CALLBACK_URL`
   - `FRONTEND_URL`
   - `OAUTH_STATE_SECRET`

## Supabase config

Auth configuration is in `supabase/config.toml`. To push changes:

```bash
GOOGLE_OAUTH_CLIENT_ID=<id> GOOGLE_OAUTH_CLIENT_SECRET=<secret> supabase config push --project-ref erwowjlaakatqsvuppzj
```

## Local development

```bash
# Install dependencies
pnpm install

# Run web app (port 3000)
pnpm dev:app

# Run backend (port 8080)
pnpm dev:backend
```

The web app needs `web/app/.env.local` — copy from `.env.local.example` and fill in values. The backend needs `backend/.env` — copy from `.env.example`.
