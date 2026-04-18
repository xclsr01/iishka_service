# OpenAI Gateway

Internal OpenAI gateway for the Iishka backend. It is designed to run on Google Cloud Run so OpenAI calls use a stable regional backend instead of the main edge runtime.

This is not a public proxy. Only the main backend should call it.

## API

```text
GET /health
GET /ready
POST /v1/chat/respond
```

`POST /v1/chat/respond` requires:

```http
Authorization: Bearer <OPENAI_GATEWAY_INTERNAL_TOKEN>
```

## Local Run

```bash
cp openai-gateway/.env.example openai-gateway/.env
npm install
npm run dev --workspace openai-gateway
```

Health check:

```bash
curl http://localhost:8081/health
```

Example request:

```bash
curl -X POST http://localhost:8081/v1/chat/respond \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_GATEWAY_INTERNAL_TOKEN" \
  -d '{
    "model": "gpt-4.1-mini",
    "messages": [
      { "role": "user", "content": "Explain AI in one sentence." }
    ],
    "requestId": "local-test"
  }'
```

## Required Env Vars

```text
APP_ENV=production
PORT=8080
OPENAI_GATEWAY_INTERNAL_TOKEN=<long random shared token>
OPENAI_API_KEY=<real OpenAI API key>
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_DEFAULT_MODEL=gpt-4.1-mini
OPENAI_REQUEST_TIMEOUT_MS=15000
OPENAI_MAX_RETRIES=2
OPENAI_RETRY_BASE_DELAY_MS=300
```

## Google Cloud Run Deployment

Recommended region for the MVP:

```text
asia-southeast1
```

Create an Artifact Registry repository once:

```bash
gcloud config set project <PROJECT_ID>
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com
gcloud artifacts repositories create openai-gateway \
  --repository-format=docker \
  --location=asia-southeast1 \
  --description="OpenAI gateway containers"
```

Build and push from the repo root:

```bash
export PROJECT_ID=<PROJECT_ID>
export IMAGE="asia-southeast1-docker.pkg.dev/${PROJECT_ID}/openai-gateway/openai-gateway:latest"

gcloud auth configure-docker asia-southeast1-docker.pkg.dev
docker build -f openai-gateway/Dockerfile -t "$IMAGE" .
docker push "$IMAGE"
```

Create secrets once:

```bash
printf "%s" "<OPENAI_API_KEY>" | gcloud secrets create OPENAI_API_KEY --data-file=-
printf "%s" "<LONG_RANDOM_INTERNAL_TOKEN>" | gcloud secrets create OPENAI_GATEWAY_INTERNAL_TOKEN --data-file=-
```

Deploy Cloud Run:

gcloud run deploy openai-gateway \
  --image "$IMAGE" \
  --region asia-southeast1 \
  --port 8080 \
  --allow-unauthenticated \
  --set-env-vars APP_ENV=production,PORT=8080,OPENAI_BASE_URL=https://api.openai.com/v1,OPENAI_DEFAULT_MODEL=gpt-4.1-mini,OPENAI_REQUEST_TIMEOUT_MS=15000,OPENAI_MAX_RETRIES=2,OPENAI_RETRY_BASE_DELAY_MS=300 \
  --set-secrets OPENAI_API_KEY=OPENAI_API_KEY:latest,OPENAI_GATEWAY_INTERNAL_TOKEN=OPENAI_GATEWAY_INTERNAL_TOKEN:latest
```

Cloud Run must be externally reachable by the main backend, so `--allow-unauthenticated` is acceptable here because the app-level bearer token protects all non-health endpoints. Do not call this service from the browser.

For more stable production egress later, route Cloud Run through VPC egress and Cloud NAT with a reserved static IP.

## Main Backend Integration

Set these on the main backend runtime:

```text
OPENAI_ENABLED=true
OPENAI_GATEWAY_URL=https://<cloud-run-service-url>
OPENAI_GATEWAY_INTERNAL_TOKEN=<same shared token>
OPENAI_MODEL=gpt-4.1-mini
```

Keep `OPENAI_API_KEY` out of the main backend once the gateway is active. The OpenAI key should live only in Cloud Run.

## Operations

Health check path:

```text
/health
```

Readiness check path:

```text
/ready
```

Logs are structured JSON and include request ids, route, model, retry count, upstream status, upstream request id, and latency. Prompts and secrets are not logged by default.
