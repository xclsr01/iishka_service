# GCP Static Egress In Singapore

This document covers Phase 5 of the migration: running the AI Gateway in Singapore with a stable outbound IP.

The goal is simple:

```text
AI Gateway Cloud Run service
        |
        | all outbound traffic
        v
Serverless VPC Access connector
        |
        v
VPC subnet in asia-southeast1
        |
        v
Cloud NAT
        |
        v
Reserved static external IP
        |
        v
AI providers
```

The code does not hardcode network configuration. The gateway exposes `GATEWAY_REGION` and `GATEWAY_EGRESS_MODE` in health responses and provider logs so deployed revisions are easier to diagnose.

## Target Settings

```text
GCP region: asia-southeast1
Gateway service: ai-gateway
Cloud Run egress: all traffic through VPC connector
VPC connector: ai-gateway-connector
Cloud NAT: ai-gateway-nat
Static IP: ai-gateway-egress-ip
Gateway env GATEWAY_REGION: asia-southeast1
Gateway env GATEWAY_EGRESS_MODE: cloud-nat-static-ip
```

## Enable APIs

```bash
gcloud services enable \
  run.googleapis.com \
  vpcaccess.googleapis.com \
  compute.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com
```

## Create Network Resources

Use a dedicated VPC unless you already have a clean production VPC.

```bash
export PROJECT_ID=<PROJECT_ID>
export REGION=asia-southeast1
export NETWORK=ai-gateway-vpc
export SUBNET=ai-gateway-subnet
export CONNECTOR=ai-gateway-connector
export ROUTER=ai-gateway-router
export NAT=ai-gateway-nat
export EGRESS_IP_NAME=ai-gateway-egress-ip

gcloud config set project "$PROJECT_ID"

gcloud compute networks create "$NETWORK" \
  --subnet-mode=custom

gcloud compute networks subnets create "$SUBNET" \
  --network="$NETWORK" \
  --region="$REGION" \
  --range=10.20.0.0/24
```

Create the Serverless VPC Access connector:

```bash
gcloud compute networks vpc-access connectors create "$CONNECTOR" \
  --region="$REGION" \
  --network="$NETWORK" \
  --range=10.21.0.0/28 \
  --min-instances=2 \
  --max-instances=3
```

Reserve a static external IP:

```bash
gcloud compute addresses create "$EGRESS_IP_NAME" \
  --region="$REGION"

gcloud compute addresses describe "$EGRESS_IP_NAME" \
  --region="$REGION" \
  --format="value(address)"
```

Create Cloud Router and Cloud NAT:

```bash
gcloud compute routers create "$ROUTER" \
  --network="$NETWORK" \
  --region="$REGION"

gcloud compute routers nats create "$NAT" \
  --router="$ROUTER" \
  --region="$REGION" \
  --nat-custom-subnet-ip-ranges="$SUBNET" \
  --nat-external-ip-pool="$EGRESS_IP_NAME"
```

## Deploy Gateway Through Static Egress

Deploy the gateway with all egress routed through the VPC connector:

```bash
gcloud run deploy ai-gateway \
  --image "$IMAGE" \
  --region "$REGION" \
  --port 8080 \
  --allow-unauthenticated \
  --vpc-connector "$CONNECTOR" \
  --vpc-egress all-traffic \
  --set-env-vars APP_ENV=production,PORT=8080,GATEWAY_REGION=asia-southeast1,GATEWAY_EGRESS_MODE=cloud-nat-static-ip,OPENAI_BASE_URL=https://api.openai.com/v1,OPENAI_DEFAULT_MODEL=gpt-5.4-mini,ANTHROPIC_BASE_URL=https://api.anthropic.com,ANTHROPIC_DEFAULT_MODEL=claude-3-5-sonnet-latest,ANTHROPIC_VERSION=2023-06-01,GOOGLE_AI_BASE_URL=https://generativelanguage.googleapis.com,GOOGLE_AI_DEFAULT_MODEL=gemini-2.0-flash,NANO_BANANA_DEFAULT_MODEL=gemini-2.5-flash-image,PROVIDER_REQUEST_TIMEOUT_MS=15000,PROVIDER_MAX_RETRIES=2,PROVIDER_RETRY_BASE_DELAY_MS=300 \
  --set-secrets AI_GATEWAY_INTERNAL_TOKEN=AI_GATEWAY_INTERNAL_TOKEN:latest,OPENAI_API_KEY=OPENAI_API_KEY:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,GOOGLE_AI_API_KEY=GOOGLE_AI_API_KEY:latest
```

`--vpc-egress all-traffic` is the important part. Without it, only private IP ranges use the connector and public provider calls can still leave through default Cloud Run egress.

## Verify Runtime Metadata

```bash
curl https://<ai-gateway-url>/health
```

Expected:

```json
{
  "ok": true,
  "service": "ai-gateway",
  "env": "production",
  "region": "asia-southeast1",
  "egressMode": "cloud-nat-static-ip"
}
```

## Verify Static Egress IP

Use a temporary debug endpoint only if needed, or run a temporary Cloud Run job/revision using the same connector and command:

```bash
node -e "fetch('https://ifconfig.me').then(r=>r.text()).then(console.log)"
```

The returned IP should match:

```bash
gcloud compute addresses describe ai-gateway-egress-ip \
  --region asia-southeast1 \
  --format="value(address)"
```

Do not keep public IP-debug endpoints in the production gateway app.

## Logs To Check

Provider calls should include:

```text
message=provider_upstream_completed
gatewayRegion=asia-southeast1
gatewayEgressMode=cloud-nat-static-ip
provider=<openai|anthropic|gemini|nano-banana>
model=<model>
upstreamStatus=<status>
upstreamRequestId=<request id if provider returns one>
latencyMs=<latency>
```

Failures should include:

```text
message=provider_upstream_failed
gatewayRegion=asia-southeast1
gatewayEgressMode=cloud-nat-static-ip
errorCode=<normalized gateway/provider code>
upstreamStatus=<provider status if available>
details.upstreamBody=<sanitized upstream body if available>
```

These fields help distinguish:

- provider rejection
- provider rate limit
- provider regional restriction
- gateway network timeout
- wrong gateway revision/env
- Cloud Run revision not using Cloud NAT

## Backend Assumption

The backend does not need VPC static egress for provider calls once Phase 3 is active. It calls only:

```text
AI_GATEWAY_URL=https://<ai-gateway-url>
AI_GATEWAY_INTERNAL_TOKEN=<shared secret>
```

Provider API keys belong to the gateway runtime, not the backend runtime.

## Rollback

If static egress causes issues:

1. Deploy a new `ai-gateway` revision without `--vpc-connector` and `--vpc-egress all-traffic`.
2. Keep the same `AI_GATEWAY_URL` if the Cloud Run service URL is unchanged.
3. Watch provider logs and compare `gatewayEgressMode`.

If the entire gateway is unhealthy:

1. Temporarily unset `AI_GATEWAY_URL` on the backend to use local/dev direct provider fallback only where configured.
2. Prefer restoring the previous working gateway revision instead for production.
