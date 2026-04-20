# AI Gateway

Internal AI provider gateway for the Iishka backend. It is designed to run on Google Cloud Run in `asia-southeast1` so provider traffic can use a stable Singapore egress path through Cloud NAT.

This is not a public proxy. Only the main backend should call it.

## API

```text
GET /health
GET /ready
POST /v1/providers/:provider/chat/respond
POST /v1/providers/:provider/jobs/execute
POST /v1/chat/respond
```

Supported `:provider` values:

```text
openai
anthropic
gemini
nano-banana
```

`POST /v1/chat/respond` is a compatibility alias for OpenAI chat responses.

All non-health endpoints require:

```http
Authorization: Bearer <AI_GATEWAY_INTERNAL_TOKEN>
```

## Local Run

```bash
cp ai-gateway/.env.example ai-gateway/.env
npm install
npm run dev --workspace ai-gateway
```

Health check:

```bash
curl http://localhost:8080/health
```

OpenAI example:

```bash
curl -X POST http://localhost:8080/v1/providers/openai/chat/respond \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AI_GATEWAY_INTERNAL_TOKEN" \
  -d '{
    "model": "gpt-4.1-mini",
    "messages": [
      { "role": "user", "content": "Explain AI in one sentence." }
    ],
    "requestId": "local-test"
  }'
```

Gemini example:

```bash
curl -X POST http://localhost:8080/v1/providers/gemini/chat/respond \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AI_GATEWAY_INTERNAL_TOKEN" \
  -d '{
    "model": "gemini-flash-latest",
    "messages": [
      { "role": "user", "content": "Explain AI in one sentence." }
    ],
    "requestId": "local-test"
  }'
```

Nano Banana image job example:

```bash
curl -X POST http://localhost:8080/v1/providers/nano-banana/jobs/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AI_GATEWAY_INTERNAL_TOKEN" \
  -d '{
    "kind": "IMAGE",
    "model": "gemini-2.5-flash-image",
    "prompt": "A neon cyberpunk banana mascot in Singapore at night",
    "jobId": "local-image-job",
    "requestId": "local-test"
  }'
```

## Required Env Vars

```text
APP_ENV=production
PORT=8080
GATEWAY_REGION=asia-southeast1
GATEWAY_EGRESS_MODE=cloud-nat-static-ip
AI_GATEWAY_INTERNAL_TOKEN=<long random shared token>

OPENAI_API_KEY=<real OpenAI API key>
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_DEFAULT_MODEL=gpt-4.1-mini

ANTHROPIC_API_KEY=<real Anthropic API key>
ANTHROPIC_BASE_URL=https://api.anthropic.com
ANTHROPIC_DEFAULT_MODEL=claude-3-5-sonnet-latest
ANTHROPIC_VERSION=2023-06-01

GOOGLE_AI_API_KEY=<real Google AI Studio API key>
GOOGLE_AI_BASE_URL=https://generativelanguage.googleapis.com
GOOGLE_AI_DEFAULT_MODEL=gemini-flash-latest
NANO_BANANA_DEFAULT_MODEL=gemini-2.5-flash-image

PROVIDER_REQUEST_TIMEOUT_MS=15000
PROVIDER_MAX_RETRIES=2
PROVIDER_RETRY_BASE_DELAY_MS=300
```

## Google Cloud Run Deployment

Recommended region:

```text
asia-southeast1
```

Create an Artifact Registry repository once:

```bash
gcloud config set project <PROJECT_ID>
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com
gcloud artifacts repositories create ai-gateway \
  --repository-format=docker \
  --location=asia-southeast1 \
  --description="AI gateway containers"
```

Build and push from the repo root:

```bash
export PROJECT_ID=<PROJECT_ID>
export IMAGE="asia-southeast1-docker.pkg.dev/${PROJECT_ID}/ai-gateway/ai-gateway:latest"

gcloud auth configure-docker asia-southeast1-docker.pkg.dev
docker build -f ai-gateway/Dockerfile -t "$IMAGE" .
docker push "$IMAGE"
```

Create secrets once:

```bash
printf "%s" "<AI_GATEWAY_INTERNAL_TOKEN>" | gcloud secrets create AI_GATEWAY_INTERNAL_TOKEN --data-file=-
printf "%s" "<OPENAI_API_KEY>" | gcloud secrets create OPENAI_API_KEY --data-file=-
printf "%s" "<ANTHROPIC_API_KEY>" | gcloud secrets create ANTHROPIC_API_KEY --data-file=-
printf "%s" "<GOOGLE_AI_API_KEY>" | gcloud secrets create GOOGLE_AI_API_KEY --data-file=-
```

Deploy Cloud Run:

```bash
gcloud run deploy ai-gateway \
  --image "$IMAGE" \
  --region asia-southeast1 \
  --port 8080 \
  --allow-unauthenticated \
  --set-env-vars APP_ENV=production,PORT=8080,GATEWAY_REGION=asia-southeast1,GATEWAY_EGRESS_MODE=default,OPENAI_BASE_URL=https://api.openai.com/v1,OPENAI_DEFAULT_MODEL=gpt-4.1-mini,ANTHROPIC_BASE_URL=https://api.anthropic.com,ANTHROPIC_DEFAULT_MODEL=claude-3-5-sonnet-latest,ANTHROPIC_VERSION=2023-06-01,GOOGLE_AI_BASE_URL=https://generativelanguage.googleapis.com,GOOGLE_AI_DEFAULT_MODEL=gemini-flash-latest,NANO_BANANA_DEFAULT_MODEL=gemini-2.5-flash-image,PROVIDER_REQUEST_TIMEOUT_MS=15000,PROVIDER_MAX_RETRIES=2,PROVIDER_RETRY_BASE_DELAY_MS=300 \
  --set-secrets AI_GATEWAY_INTERNAL_TOKEN=AI_GATEWAY_INTERNAL_TOKEN:latest,OPENAI_API_KEY=OPENAI_API_KEY:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,GOOGLE_AI_API_KEY=GOOGLE_AI_API_KEY:latest
```

Cloud Run may be externally reachable by the main backend, but all provider endpoints require app-level bearer auth. Do not call this service from the browser.

For fixed production egress, route Cloud Run through VPC egress and Cloud NAT with a reserved static IP in `asia-southeast1`. See `docs/deployment/gcp-static-egress-singapore.md`.

## Main Backend Integration

Phase 3 updates the main backend provider adapters to call this gateway instead of provider APIs directly.

Target backend env:

```text
AI_GATEWAY_URL=https://<cloud-run-service-url>
AI_GATEWAY_INTERNAL_TOKEN=<same shared token>
```

Provider API keys should live only in the gateway runtime after Phase 3.

## Operations

Health check path:

```text
/health
```

Readiness check path:

```text
/ready
```

Logs are structured JSON and include request id, route, provider, model, gateway region, egress mode, retry count, upstream status, upstream request id, and latency. Prompts and secrets are not logged by default.
