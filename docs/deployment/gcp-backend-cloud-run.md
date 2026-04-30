# GCP Backend Cloud Run Deployment

This document covers Phase 4 of the migration: running the main Iishka backend on Google Cloud Run while keeping Supabase as the data and storage layer.

The frontend remains on Cloudflare. The AI Gateway is a separate Cloud Run service. Supabase Postgres and Supabase Storage remain unchanged.

## Runtime Shape

```text
Cloudflare Pages frontend
        |
        v
Google Cloud Run backend
        |
        | DATABASE_URL / SUPABASE_SERVICE_ROLE_KEY
        v
Supabase Postgres + Supabase Storage
        |
        | AI_GATEWAY_URL / AI_GATEWAY_INTERNAL_TOKEN
        v
Google Cloud Run AI Gateway
```

The backend container runs:

```bash
node dist/index.js
```

Cloud Run provides `PORT`; the container defaults to `8080`.

Health endpoint:

```text
GET /health
```

## Required GCP Services

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com
```

## Build Image

Create an Artifact Registry repository once:

```bash
gcloud artifacts repositories create iishka-service \
  --repository-format=docker \
  --location=asia-southeast1 \
  --description="Iishka backend containers"
```

Build and push from the repo root:

```bash
export PROJECT_ID=<PROJECT_ID>
export IMAGE="asia-southeast1-docker.pkg.dev/${PROJECT_ID}/iishka-service/iishka-service:latest"

gcloud auth configure-docker asia-southeast1-docker.pkg.dev
docker build -f backend/Dockerfile -t "$IMAGE" .
docker push "$IMAGE"
```

## Secrets

Store secrets in Secret Manager. Do not put provider secrets in the backend once the AI Gateway is active.

Create secrets once:

```bash
printf "%s" "<DATABASE_URL>" | gcloud secrets create DATABASE_URL --data-file=-
printf "%s" "<DIRECT_URL>" | gcloud secrets create DIRECT_URL --data-file=-
printf "%s" "<JWT_SECRET>" | gcloud secrets create JWT_SECRET --data-file=-
printf "%s" "<TELEGRAM_BOT_TOKEN>" | gcloud secrets create TELEGRAM_BOT_TOKEN --data-file=-
printf "%s" "<TELEGRAM_WEBHOOK_SECRET>" | gcloud secrets create TELEGRAM_WEBHOOK_SECRET --data-file=-
printf "%s" "<AI_GATEWAY_INTERNAL_TOKEN>" | gcloud secrets create AI_GATEWAY_INTERNAL_TOKEN --data-file=-
printf "%s" "<SUPABASE_SERVICE_ROLE_KEY>" | gcloud secrets create SUPABASE_SERVICE_ROLE_KEY --data-file=-
printf "%s" "<UPSTASH_REDIS_REST_TOKEN>" | gcloud secrets create UPSTASH_REDIS_REST_TOKEN --data-file=-
```

`SUPABASE_SERVICE_ROLE_KEY` must be a server-only elevated Supabase API key for the same project as
`SUPABASE_URL`: preferably a newer `sb_secret_...` secret key, or the legacy JWT `service_role` key.
Do not use the public `anon` key. The backend validates this at startup when
`UPLOAD_STORAGE_DRIVER=supabase`; an anon key will fail storage writes with Supabase RLS errors.

If the secret already exists with the anon key, add a new Secret Manager version with the real
server-only elevated key, then redeploy the backend so `SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest`
resolves to the corrected version:

```bash
printf "%s" "<REAL_SUPABASE_SECRET_OR_SERVICE_ROLE_KEY>" | \
  gcloud secrets versions add SUPABASE_SERVICE_ROLE_KEY --data-file=-
```

You can find these keys in Supabase project settings under API keys. They are server-only;
never put them in frontend or Cloudflare Pages variables.

Recommended Supabase connection split:

```text
DATABASE_URL=<Supabase pooled runtime URL>
DIRECT_URL=<Supabase direct 5432 URL for migrations>
```

For runtime Cloud Run traffic, prefer the Supabase pooler URL in `DATABASE_URL`.

## Deploy Cloud Run

```bash
gcloud run deploy iishka-service \
  --image "$IMAGE" \
  --region asia-southeast1 \
  --port 8080 \
  --allow-unauthenticated \
  --set-env-vars APP_ENV=production,PORT=8080,FRONTEND_URL=https://<cloudflare-pages-domain>,API_BASE_URL=https://<backend-domain>,TELEGRAM_BOT_USERNAME=<bot-username>,TELEGRAM_MINI_APP_URL=https://<mini-app-url>,TELEGRAM_DELIVERY_MODE=webhook,AI_GATEWAY_URL=https://<ai-gateway-url>,AI_GATEWAY_TIMEOUT_MS=15000,OPENAI_ENABLED=true,OPENAI_MODEL=gpt-5.4-mini,ANTHROPIC_MODEL=claude-3-5-sonnet-latest,GOOGLE_AI_MODEL=gemini-2.5-flash,NANO_BANANA_MODEL=gemini-2.5-flash-image,UPLOAD_STORAGE_DRIVER=supabase,SUPABASE_URL=https://<project-ref>.supabase.co,SUPABASE_STORAGE_BUCKET=chat-uploads,RATE_LIMIT_DRIVER=upstash,UPSTASH_REDIS_REST_URL=https://<upstash-rest-url>,TRUST_PLATFORM_CLIENT_IP_HEADERS=true,RATE_LIMIT_WINDOW_SECONDS=60,RATE_LIMIT_MAX_REQUESTS=120,JOB_QUEUE_DRIVER=db,JOB_WORKER_POLL_INTERVAL_MS=5000,JOB_WORKER_BATCH_SIZE=1,JOB_RUNNING_STALE_AFTER_SECONDS=900,JOB_MAX_ATTEMPTS=3,ENABLE_DEV_AUTH=false,ENABLE_DEV_SUBSCRIPTION_OVERRIDE=false \
  --set-secrets DATABASE_URL=DATABASE_URL:latest,DIRECT_URL=DIRECT_URL:latest,JWT_SECRET=JWT_SECRET:latest,TELEGRAM_BOT_TOKEN=TELEGRAM_BOT_TOKEN:latest,TELEGRAM_WEBHOOK_SECRET=TELEGRAM_WEBHOOK_SECRET:latest,AI_GATEWAY_INTERNAL_TOKEN=AI_GATEWAY_INTERNAL_TOKEN:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,UPSTASH_REDIS_REST_TOKEN=UPSTASH_REDIS_REST_TOKEN:latest
```

`--allow-unauthenticated` is required for the frontend and Telegram webhook to reach the backend. Application auth still protects user APIs, and the Telegram webhook route validates the configured webhook secret.

The repo Cloud Build file, `cloudbuild.iishka-service.yaml`, deploys the same Cloud Run service name:
`iishka-service`.

## Generation Job Worker

Production API instances use `JOB_QUEUE_DRIVER=db`, so routes only persist jobs and return. Deploy a separate Cloud Run worker from the same image with the command equivalent to:

```bash
npm run start:jobs --workspace backend
```

Use the same production secrets and env vars as the API service, but keep `--no-allow-unauthenticated` because the worker has no public HTTP surface. Set `JOB_WORKER_CLAIM_OWNER` to a stable service prefix plus instance identity when available. The worker claims due `QUEUED` jobs with Postgres row locks, heartbeats active work, and requeues stale `RUNNING` rows until `JOB_MAX_ATTEMPTS` is reached.

## Database Migrations

Do not run migrations automatically during container startup.

Run migrations as a separate operator step before or after deployment:

```bash
DATABASE_URL="<DIRECT_OR_MIGRATION_DATABASE_URL>" \
DIRECT_URL="<DIRECT_OR_MIGRATION_DATABASE_URL>" \
npm run db:deploy --workspace backend
```

The Prisma config prevents running migrate commands against the Supabase pooler URL on port `6543`.

## Telegram Webhook

After the backend is deployed, point Telegram at the Cloud Run backend:

```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<backend-domain>/api/telegram/webhook",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
  }'
```

Verify:

```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

## Cloudflare Frontend Env

Update Cloudflare Pages:

```text
VITE_API_BASE_URL=https://<backend-domain>
VITE_ENABLE_DEV_AUTH=false
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<public publishable key>
```

No provider keys and no gateway token belong in frontend vars.

## Smoke Checks

```bash
curl https://<backend-domain>/health
curl https://<backend-domain>/api/catalog/providers
```

Then test in Telegram:

```text
/start
Open Mini App
Send a Gemini message
Create a Nano Banana image job
```

## Rollback

Keep the previous Cloudflare Worker deployment available until the Cloud Run backend is verified.

Rollback steps:

1. Point Cloudflare Pages `VITE_API_BASE_URL` back to the Worker URL.
2. Reset Telegram webhook to the Worker URL.
3. Keep Supabase unchanged.

No database migration is required just to move backend runtime between Cloudflare Workers and Cloud Run.
