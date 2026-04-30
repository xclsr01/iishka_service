# Cloudflare Worker To GCP Cloud Run Migration

This checklist migrates the backend runtime from Cloudflare Workers to Google Cloud Run while keeping:

- frontend on Cloudflare Pages
- database on Supabase Postgres
- uploads/assets on Supabase Storage
- provider calls routed through the AI Gateway in Singapore

The migration is intentionally reversible. Supabase data does not move.

## Target Runtime

```text
Cloudflare Pages
frontend
        |
        v
Cloud Run backend
        |
        v
Supabase Postgres + Storage
        |
        v
Cloud Run AI Gateway
        |
        v
Singapore static egress IP
```

## Pre-Migration Checklist

- Confirm `main` or the release branch includes `backend/Dockerfile`.
- Confirm `main` or the release branch includes `ai-gateway/Dockerfile`.
- Confirm Supabase migrations are current.
- Confirm `DATABASE_URL` points to the Supabase pooled runtime URL.
- Confirm `DIRECT_URL` points to the Supabase direct `5432` URL.
- Confirm Cloudflare Pages can update `VITE_API_BASE_URL`.
- Confirm Telegram bot token and webhook secret are available.
- Confirm provider API keys are ready for the AI Gateway secrets.
- Confirm `AI_GATEWAY_INTERNAL_TOKEN` is generated and at least 32 characters.
- Confirm GCP project has billing enabled.
- Confirm `gcloud` is authenticated against the correct project.

## Migration Order

1. Deploy the AI Gateway image.
2. Configure AI Gateway secrets.
3. Configure Singapore static egress for the gateway.
4. Verify gateway `/health`.
5. Deploy the backend image.
6. Configure backend secrets.
7. Run Prisma migrations against Supabase direct URL if needed.
8. Verify backend `/health` and `/api/catalog/providers`.
9. Update Cloudflare Pages `VITE_API_BASE_URL` to the Cloud Run backend URL.
10. Redeploy Cloudflare Pages.
11. Set Telegram webhook to the Cloud Run backend URL.
12. Run the smoke-test checklist.

## AI Gateway Deployment

Use:

- `ai-gateway/README.md`
- `docs/deployment/gcp-static-egress-singapore.md`

Minimum runtime env:

```text
APP_ENV=production
PORT=8080
GATEWAY_REGION=asia-southeast1
GATEWAY_EGRESS_MODE=cloud-nat-static-ip
AI_GATEWAY_INTERNAL_TOKEN=<secret>
OPENAI_API_KEY=<secret>
ANTHROPIC_API_KEY=<secret>
GOOGLE_AI_API_KEY=<secret>
```

Verify:

```bash
curl https://<ai-gateway-url>/health
```

Expected:

```text
service=ai-gateway
region=asia-southeast1
egressMode=cloud-nat-static-ip
```

## Backend Deployment

Use:

- `docs/deployment/gcp-backend-cloud-run.md`

Minimum runtime env:

```text
APP_ENV=production
PORT=8080
FRONTEND_URL=https://<cloudflare-pages-domain>
API_BASE_URL=https://<backend-domain>
DATABASE_URL=<supabase pooled runtime url>
DIRECT_URL=<supabase direct url>
JWT_SECRET=<secret>
TELEGRAM_BOT_TOKEN=<secret>
TELEGRAM_WEBHOOK_SECRET=<secret>
TELEGRAM_MINI_APP_URL=https://<mini-app-url>
TELEGRAM_DELIVERY_MODE=webhook
AI_GATEWAY_URL=https://<ai-gateway-url>
AI_GATEWAY_INTERNAL_TOKEN=<same gateway token>
UPLOAD_STORAGE_DRIVER=supabase
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<Supabase sb_secret_... key or legacy service_role JWT for the same project>
SUPABASE_STORAGE_BUCKET=chat-uploads
RATE_LIMIT_DRIVER=upstash
UPSTASH_REDIS_REST_URL=https://<upstash-rest-url>
UPSTASH_REDIS_REST_TOKEN=<secret>
TRUST_PLATFORM_CLIENT_IP_HEADERS=true
ENABLE_DEV_AUTH=false
ENABLE_DEV_SUBSCRIPTION_OVERRIDE=false
```

Do not use the Supabase anon key for `SUPABASE_SERVICE_ROLE_KEY`. With Supabase Storage RLS enabled,
the backend needs a server-only elevated key to persist generated files and uploads.

Verify:

```bash
curl https://<backend-domain>/health
curl https://<backend-domain>/api/catalog/providers
```

## Cloudflare Pages Cutover

Set Pages production variables:

```text
VITE_API_BASE_URL=https://<backend-domain>
VITE_ENABLE_DEV_AUTH=false
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<public publishable key>
```

Redeploy Pages after changing variables.

The frontend should never receive:

- `AI_GATEWAY_INTERNAL_TOKEN`
- provider API keys
- `SUPABASE_SERVICE_ROLE_KEY`
- database URLs
- Telegram bot token

## Telegram Webhook Cutover

Set webhook to the Cloud Run backend:

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

Expected:

```text
url=https://<backend-domain>/api/telegram/webhook
pending_update_count should not keep increasing
```

## Rollback Plan

Rollback is mostly routing-level because Supabase remains unchanged.

### Roll Back Frontend API Target

Set Cloudflare Pages:

```text
VITE_API_BASE_URL=https://<previous-worker-backend-url>
```

Redeploy Pages.

### Roll Back Telegram Webhook

```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<previous-worker-backend-url>/api/telegram/webhook",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
  }'
```

### Roll Back Backend Revision

If only the latest Cloud Run backend revision is bad:

```bash
gcloud run services update-traffic iishka-backend \
  --region asia-southeast1 \
  --to-revisions <previous-revision>=100
```

### Roll Back Gateway Revision

If only the latest gateway revision is bad:

```bash
gcloud run services update-traffic ai-gateway \
  --region asia-southeast1 \
  --to-revisions <previous-revision>=100
```

## Post-Migration Cleanup

Do this only after production is stable:

- Remove provider API keys from backend runtime secrets.
- Keep Cloudflare Worker backend config only if it remains a supported rollback path.
- Document the active backend URL in deployment notes.
- Confirm logs show provider calls coming from `ai-gateway`, not direct backend transport.
- Confirm gateway logs show `gatewayEgressMode=cloud-nat-static-ip`.
