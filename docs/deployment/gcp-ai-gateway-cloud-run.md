# GCP AI Gateway Cloud Run Deployment

This document deploys the internal AI Gateway to Google Cloud Run. For fixed Singapore egress, pair this with `docs/deployment/gcp-static-egress-singapore.md`.

The gateway is not browser-facing product API. It is called by the backend with `AI_GATEWAY_INTERNAL_TOKEN`.

## Runtime Shape

```text
Cloud Run ai-gateway
        |
        | provider API keys
        v
AI providers
```

With static egress enabled:

```text
Cloud Run ai-gateway
        |
        v
Serverless VPC Access connector
        |
        v
Cloud NAT
        |
        v
Reserved static external IP in asia-southeast1
```

## Required Services

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com
```

Static egress additionally requires:

```bash
gcloud services enable \
  vpcaccess.googleapis.com \
  compute.googleapis.com
```

## Build Image

```bash
export PROJECT_ID=<PROJECT_ID>
export REGION=asia-southeast1
export IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/ai-gateway/ai-gateway:latest"

gcloud artifacts repositories create ai-gateway \
  --repository-format=docker \
  --location="$REGION" \
  --description="AI gateway containers"

gcloud auth configure-docker "${REGION}-docker.pkg.dev"
docker build -f ai-gateway/Dockerfile -t "$IMAGE" .
docker push "$IMAGE"
```

## Secrets

```bash
printf "%s" "<AI_GATEWAY_INTERNAL_TOKEN>" | gcloud secrets create AI_GATEWAY_INTERNAL_TOKEN --data-file=-
printf "%s" "<OPENAI_API_KEY>" | gcloud secrets create OPENAI_API_KEY --data-file=-
printf "%s" "<ANTHROPIC_API_KEY>" | gcloud secrets create ANTHROPIC_API_KEY --data-file=-
printf "%s" "<GOOGLE_AI_API_KEY>" | gcloud secrets create GOOGLE_AI_API_KEY --data-file=-
```

## Deploy Without Static Egress

Use this for first bootstrapping only:

```bash
gcloud run deploy ai-gateway \
  --image "$IMAGE" \
  --region "$REGION" \
  --port 8080 \
  --allow-unauthenticated \
  --set-env-vars APP_ENV=production,PORT=8080,GATEWAY_REGION=asia-southeast1,GATEWAY_EGRESS_MODE=default,OPENAI_BASE_URL=https://api.openai.com/v1,OPENAI_DEFAULT_MODEL=gpt-5.4-mini,ANTHROPIC_BASE_URL=https://api.anthropic.com,ANTHROPIC_DEFAULT_MODEL=claude-3-5-sonnet-latest,ANTHROPIC_VERSION=2023-06-01,GOOGLE_AI_BASE_URL=https://generativelanguage.googleapis.com,GOOGLE_AI_DEFAULT_MODEL=gemini-3-flash-preview,NANO_BANANA_DEFAULT_MODEL=gemini-2.5-flash-image,PROVIDER_REQUEST_TIMEOUT_MS=15000,PROVIDER_MAX_RETRIES=2,PROVIDER_RETRY_BASE_DELAY_MS=300 \
  --set-secrets AI_GATEWAY_INTERNAL_TOKEN=AI_GATEWAY_INTERNAL_TOKEN:latest,OPENAI_API_KEY=OPENAI_API_KEY:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,GOOGLE_AI_API_KEY=GOOGLE_AI_API_KEY:latest
```

## Deploy With Static Egress

After creating VPC connector and Cloud NAT from `gcp-static-egress-singapore.md`:

```bash
gcloud run deploy ai-gateway \
  --image "$IMAGE" \
  --region "$REGION" \
  --port 8080 \
  --allow-unauthenticated \
  --vpc-connector ai-gateway-connector \
  --vpc-egress all-traffic \
  --set-env-vars APP_ENV=production,PORT=8080,GATEWAY_REGION=asia-southeast1,GATEWAY_EGRESS_MODE=cloud-nat-static-ip,OPENAI_BASE_URL=https://api.openai.com/v1,OPENAI_DEFAULT_MODEL=gpt-5.4-mini,ANTHROPIC_BASE_URL=https://api.anthropic.com,ANTHROPIC_DEFAULT_MODEL=claude-3-5-sonnet-latest,ANTHROPIC_VERSION=2023-06-01,GOOGLE_AI_BASE_URL=https://generativelanguage.googleapis.com,GOOGLE_AI_DEFAULT_MODEL=gemini-3-flash-preview,NANO_BANANA_DEFAULT_MODEL=gemini-2.5-flash-image,PROVIDER_REQUEST_TIMEOUT_MS=15000,PROVIDER_MAX_RETRIES=2,PROVIDER_RETRY_BASE_DELAY_MS=300 \
  --set-secrets AI_GATEWAY_INTERNAL_TOKEN=AI_GATEWAY_INTERNAL_TOKEN:latest,OPENAI_API_KEY=OPENAI_API_KEY:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,GOOGLE_AI_API_KEY=GOOGLE_AI_API_KEY:latest
```

## Health

```bash
curl https://<ai-gateway-url>/health
curl https://<ai-gateway-url>/ready
```

Expected static-egress response:

```json
{
  "ok": true,
  "service": "ai-gateway",
  "env": "production",
  "region": "asia-southeast1",
  "egressMode": "cloud-nat-static-ip"
}
```

## Auth Check

Unauthenticated provider request should return `401`:

```bash
curl -X POST https://<ai-gateway-url>/v1/providers/gemini/chat/respond \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-3-flash-preview","messages":[{"role":"user","content":"ping"}]}'
```

Authenticated request should return `200` if the provider key is valid:

```bash
curl -X POST https://<ai-gateway-url>/v1/providers/gemini/chat/respond \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${AI_GATEWAY_INTERNAL_TOKEN}" \
  -d '{"model":"gemini-3-flash-preview","messages":[{"role":"user","content":"Reply pong"}]}'
```

## Backend Integration

Set these on the backend Cloud Run service:

```text
AI_GATEWAY_URL=https://<ai-gateway-url>
AI_GATEWAY_INTERNAL_TOKEN=<same secret>
AI_GATEWAY_TIMEOUT_MS=15000
```

Provider API keys should not be set on the backend in production once gateway routing is active.
