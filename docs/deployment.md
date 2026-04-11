# Deployment

## Web app (Vercel)

Deploys to Vercel under the **Galvyn** team as a single Next.js app serving both user and admin routes.

### app.a1de.xyz (`web/app/`)

1. Connect the GitHub repo to a new Vercel project
2. Settings:
   - Framework: Next.js
   - Root Directory: `web/app`
   - Build Command: `pnpm build` (auto-detected)
   - Install Command: `pnpm install` (auto-detected)
3. Environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://erwowjlaakatqsvuppzj.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = (from Supabase dashboard)
4. Domain: `app.a1de.xyz`

### pnpm workspace note

Vercel detects `pnpm-workspace.yaml` at the repo root and installs dependencies for the full workspace. The `Root Directory` setting tells Vercel which package to build.

## Backend (Cloud Run)

Not deployed yet. When ready:

1. Build Docker image from `backend/Dockerfile`
2. Push to GCR in project `a1de-assistant`
3. Deploy to Cloud Run with environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

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
