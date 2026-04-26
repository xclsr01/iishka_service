# Smoke-Test And Validation Checklist

Use this checklist after local changes, after Cloud Run deployment, and during the Cloudflare Worker to GCP migration.

## 1. Local Development

Install and build:

```bash
npm install
npm run lint
npm run build
```

Backend tests:

```bash
npm run test --workspace backend
```

Local services:

```bash
npm run dev:gateway
npm run dev:backend
npm run dev:frontend
```

Expected local endpoints:

```text
frontend: http://localhost:5173
backend: http://localhost:8787
gateway: http://localhost:8080
```

Local health checks:

```bash
curl http://localhost:8080/health
curl http://localhost:8787/health
```

## 2. Gateway Health

Production gateway:

```bash
curl https://<ai-gateway-url>/health
curl https://<ai-gateway-url>/ready
```

Expected:

```text
ok=true
service=ai-gateway
env=production
region=asia-southeast1
egressMode=cloud-nat-static-ip
```

If `egressMode=default`, the Cloud Run revision is not the static-egress revision or env vars are wrong.

## 3. Backend To Gateway Auth

Unauthenticated gateway provider requests must fail:

```bash
curl -X POST https://<ai-gateway-url>/v1/providers/gemini/chat/respond \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-2.5-flash","messages":[{"role":"user","content":"ping"}]}'
```

Expected:

```text
HTTP 401
code=GATEWAY_UNAUTHORIZED
```

Authenticated gateway provider request:

```bash
curl -X POST https://<ai-gateway-url>/v1/providers/gemini/chat/respond \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${AI_GATEWAY_INTERNAL_TOKEN}" \
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [
      { "role": "user", "content": "Reply with the word pong." }
    ],
    "requestId": "smoke-gemini"
  }'
```

Expected:

```text
HTTP 200
text is non-empty
provider=gemini
usage may be present
```

## 4. Backend Health And Supabase Connectivity

Backend health:

```bash
curl https://<backend-domain>/health
```

Catalog read checks database connectivity:

```bash
curl https://<backend-domain>/api/catalog/providers
```

Expected:

```text
HTTP 200
providers array includes OPENAI, ANTHROPIC, GEMINI, NANO_BANANA
```

If this fails:

- check `DATABASE_URL`
- check Supabase network/password
- check Prisma migrations
- check Cloud Run logs for `request_failed`

## 5. Frontend To Backend Connectivity

Cloudflare Pages env:

```text
VITE_API_BASE_URL=https://<backend-domain>
VITE_ENABLE_DEV_AUTH=false
```

Browser checks:

- Open Mini App URL in Telegram.
- Confirm bootstrap succeeds.
- Confirm provider catalog renders.
- Confirm subscription card loads.

If the frontend shows bootstrap errors:

- check `FRONTEND_URL` on backend
- check Cloudflare Pages `VITE_API_BASE_URL`
- check Telegram `initData` verification
- check backend logs for `/api/auth/telegram/bootstrap`

## 6. Telegram Bot Flow

Verify webhook:

```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

Expected:

```text
url=https://<backend-domain>/api/telegram/webhook
pending_update_count not increasing continuously
last_error_message empty or old
```

Manual Telegram test:

```text
Send /start to the bot
Tap Open Mini App
Confirm Mini App opens
```

## 7. Provider Request Flow

### Gemini Chat

In the Mini App:

```text
Open Gemini
Send: "Скажи коротко: тест успешен"
```

Expected:

- user message appears immediately
- assistant message appears
- no blank screen
- token counter decreases
- backend logs include `provider_execution_completed`
- gateway logs include `provider_upstream_completed` with `provider=gemini`

### OpenAI Chat

In the Mini App:

```text
Open ChatGPT
Send: "Reply with one short sentence"
```

Expected:

- response arrives or safe provider error appears
- backend logs include `providerKey=OPENAI`
- gateway logs include `provider=openai`

### Anthropic Chat

In the Mini App:

```text
Open Claude
Send: "Reply with one short sentence"
```

Expected:

- response arrives or safe provider error appears
- no raw upstream JSON is displayed to the user
- backend logs include normalized provider error fields if it fails

### Nano Banana Image Job

In the Mini App:

```text
Open Nano Banana
Prompt: "Нарисуй банан-робота в неоновом городе"
Tap generate
```

Expected:

- job status moves from queued/running to completed
- image preview appears
- image history persists after reopening the screen
- download button works
- no stale `Load failed` appears after a completed image
- backend logs include `generation_job_run_completed`
- gateway logs include `provider=nano-banana`

## 8. Logging Visibility

Backend logs should include:

```text
requestId
method
path
userId when authenticated
telegramUserId when authenticated
providerKey for provider failures
upstreamStatus when available
upstreamRequestId when available
```

Gateway logs should include:

```text
requestId
route
provider
model
gatewayRegion=asia-southeast1
gatewayEgressMode=cloud-nat-static-ip
retryCount
upstreamStatus
upstreamRequestId
latencyMs
```

Logs must not include:

- provider API keys
- Telegram bot token
- JWT secret
- gateway internal token
- Supabase service role key
- full user prompts by default

## 9. Static Egress Validation

Check gateway metadata:

```bash
curl https://<ai-gateway-url>/health
```

Expected:

```text
egressMode=cloud-nat-static-ip
region=asia-southeast1
```

Verify actual egress IP using a temporary debug job/revision with the same VPC connector:

```bash
node -e "fetch('https://ifconfig.me').then(r=>r.text()).then(console.log)"
```

Expected IP must match:

```bash
gcloud compute addresses describe ai-gateway-egress-ip \
  --region asia-southeast1 \
  --format="value(address)"
```

Do not keep an IP-debug endpoint in production.

## 10. Rollback Checks

Before cutover, record:

```text
previous Cloudflare Worker backend URL
previous Telegram webhook URL
previous Cloudflare Pages env values
previous Cloud Run backend revision
previous Cloud Run gateway revision
```

Rollback frontend:

```text
Set VITE_API_BASE_URL back to previous backend URL
Redeploy Cloudflare Pages
```

Rollback Telegram:

```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<previous-backend-url>/api/telegram/webhook",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
  }'
```

Rollback Cloud Run revision:

```bash
gcloud run services update-traffic <service-name> \
  --region asia-southeast1 \
  --to-revisions <previous-revision>=100
```

## Pass Criteria

Migration is healthy when:

- Cloudflare frontend loads the Mini App.
- Telegram `/start` opens the Mini App.
- Backend `/health` is 200.
- Backend catalog endpoint returns providers.
- Gateway `/health` is 200 and reports static egress mode.
- Gemini chat succeeds.
- At least one non-Gemini provider path either succeeds or returns a safe user-facing error.
- Nano Banana job completes and image history persists.
- Backend logs and gateway logs share request ids where applicable.
- No provider secret is present in frontend vars.
