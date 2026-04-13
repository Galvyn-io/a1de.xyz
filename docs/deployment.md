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
- `NEXT_PUBLIC_BACKEND_URL` = `https://a1de-backend-161515709709.us-west1.run.app`

### pnpm workspace note

Vercel detects `pnpm-workspace.yaml` at the repo root and installs dependencies for the full workspace. The `Root Directory` setting tells Vercel which package to build.

## Backend (Cloud Run)

- **Service:** `a1de-backend`
- **URL:** `https://a1de-backend-161515709709.us-west1.run.app`
- **Region:** `us-west1` (close to Supabase in us-west-1)
- **GCP Project:** `a1de-assistant` (always pass `--project a1de-assistant` to gcloud)
- **Image:** `us-west1-docker.pkg.dev/a1de-assistant/cloud-run-source-deploy/a1de-backend:latest`
- **Labels:** `app=a1de`, `component=backend`, `env=production`

### Deploying

```bash
# 1. Build image (from repo root, not backend/)
gcloud builds submit \
  --project a1de-assistant \
  --region us-west1 \
  --tag us-west1-docker.pkg.dev/a1de-assistant/cloud-run-source-deploy/a1de-backend:latest .

# 2. Deploy
gcloud run deploy a1de-backend \
  --project a1de-assistant \
  --region us-west1 \
  --image us-west1-docker.pkg.dev/a1de-assistant/cloud-run-source-deploy/a1de-backend:latest
```

Both the root `Dockerfile` and `backend/Dockerfile` exist and are identical. Cloud Build must run from the repo root so `pnpm-workspace.yaml` is in the build context.

### Environment variables

Set on the Cloud Run service (not baked into the image). To update:

```bash
gcloud run services update a1de-backend \
  --project a1de-assistant --region us-west1 \
  --update-env-vars="KEY=value"
```

Current env vars:
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_ANON_KEY` — Supabase anonymous key
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (bypasses RLS)
- `GOOGLE_OAUTH_CLIENT_ID` — GCP OAuth client ID
- `GOOGLE_OAUTH_CLIENT_SECRET` — GCP OAuth client secret
- `OAUTH_CALLBACK_URL` — `https://a1de-backend-161515709709.us-west1.run.app/connectors/google/callback`
- `FRONTEND_URL` — `https://app.a1de.xyz`
- `OAUTH_STATE_SECRET` — Min 32-char secret for signing OAuth state JWTs
- `ANTHROPIC_API_KEY` — Anthropic API key for Claude
- `LANGFUSE_PUBLIC_KEY` — Langfuse public key for telemetry
- `LANGFUSE_SECRET_KEY` — Langfuse secret key for telemetry
- `LANGFUSE_BASE_URL` — `https://us.cloud.langfuse.com`

### Viewing logs

```bash
gcloud run services logs read a1de-backend \
  --project a1de-assistant --region us-west1 --limit 50
```

## Telemetry (Langfuse)

All Claude API calls are automatically traced via Langfuse + OpenTelemetry.

- **Dashboard:** https://us.cloud.langfuse.com
- **Project:** `a1de.xyz`
- **What's traced:** Every Claude call with full prompt/response, token usage, latency, cost, user ID, conversation ID (session)
- **Setup:** `backend/src/telemetry.ts` initializes OpenTelemetry with `LangfuseSpanProcessor` and `AnthropicInstrumentation` before the Anthropic SDK is imported

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
