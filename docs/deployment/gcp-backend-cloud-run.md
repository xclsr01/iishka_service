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
gcloud artifacts repositories create iishka-backend \
  --repository-format=docker \
  --location=asia-southeast1 \
  --description="Iishka backend containers"
```

Build and push from the repo root:

```bash
export PROJECT_ID=<PROJECT_ID>
export IMAGE="asia-southeast1-docker.pkg.dev/${PROJECT_ID}/iishka-backend/iishka-backend:latest"

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
```

Recommended Supabase connection split:

```text
DATABASE_URL=<Supabase pooled runtime URL>
DIRECT_URL=<Supabase direct 5432 URL for migrations>
```

For runtime Cloud Run traffic, prefer the Supabase pooler URL in `DATABASE_URL`.

## Deploy Cloud Run

```bash
gcloud run deploy iishka-backend \
  --image "$IMAGE" \
  --region asia-southeast1 \
  --port 8080 \
  --allow-unauthenticated \
  --set-env-vars APP_ENV=production,PORT=8080,FRONTEND_URL=https://<cloudflare-pages-domain>,API_BASE_URL=https://<backend-domain>,TELEGRAM_BOT_USERNAME=<bot-username>,TELEGRAM_MINI_APP_URL=https://<mini-app-url>,TELEGRAM_DELIVERY_MODE=webhook,AI_GATEWAY_URL=https://<ai-gateway-url>,AI_GATEWAY_TIMEOUT_MS=15000,OPENAI_ENABLED=true,OPENAI_MODEL=gpt-5.4-mini,ANTHROPIC_MODEL=claude-3-5-sonnet-latest,GOOGLE_AI_MODEL=gemini-2.0-flash,NANO_BANANA_MODEL=gemini-2.5-flash-image,UPLOAD_STORAGE_DRIVER=supabase,SUPABASE_URL=https://<project-ref>.supabase.co,SUPABASE_STORAGE_BUCKET=chat-uploads,RATE_LIMIT_WINDOW_SECONDS=60,RATE_LIMIT_MAX_REQUESTS=120,ENABLE_DEV_AUTH=false,ENABLE_DEV_SUBSCRIPTION_OVERRIDE=false \
  --set-secrets DATABASE_URL=DATABASE_URL:latest,DIRECT_URL=DIRECT_URL:latest,JWT_SECRET=JWT_SECRET:latest,TELEGRAM_BOT_TOKEN=TELEGRAM_BOT_TOKEN:latest,TELEGRAM_WEBHOOK_SECRET=TELEGRAM_WEBHOOK_SECRET:latest,AI_GATEWAY_INTERNAL_TOKEN=AI_GATEWAY_INTERNAL_TOKEN:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest
```

`--allow-unauthenticated` is required for the frontend and Telegram webhook to reach the backend. Application auth still protects user APIs, and the Telegram webhook route validates the configured webhook secret.

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
