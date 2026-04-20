# Iishka AI Hub

## Overview
Iishka AI Hub is a Telegram AI aggregation product with two user surfaces:

- a Telegram bot that handles discovery and opens the Mini App
- a Telegram Mini App that lets a user browse providers, manage subscription state, chat with AI providers, and run async generation jobs

The repository is a production-oriented modular monolith plus one internal gateway app:

- `frontend`: React + Vite + TypeScript Telegram Mini App
- `backend`: Hono + TypeScript + Prisma API, Telegram bot backend, orchestration, jobs, subscriptions, and persistence
- `ai-gateway`: internal Hono + TypeScript provider gateway for fixed-region AI provider egress

The current provider set is:

- OpenAI / ChatGPT
- Anthropic / Claude
- Google / Gemini
- Google Nano Banana image generation

## Target Production Architecture

```text
Telegram Mini App
        |
        v
Cloudflare Pages
frontend static hosting
        |
        | HTTPS
        v
Google Cloud Run
backend modular monolith
        |
        | DATABASE_URL / SUPABASE_SERVICE_ROLE_KEY
        v
Supabase
Postgres + Storage
        |
        | AI_GATEWAY_URL / AI_GATEWAY_INTERNAL_TOKEN
        v
Google Cloud Run
AI Gateway in asia-southeast1
        |
        | VPC connector + Cloud NAT
        v
Static Singapore egress IP
        |
        v
OpenAI / Anthropic / Google AI providers
```

Runtime placement:

- frontend remains on Cloudflare Pages
- backend API runs on Google Cloud Run
- AI Gateway runs on Google Cloud Run in Singapore, `asia-southeast1`
- AI Gateway provider traffic is routed through VPC + Cloud NAT + reserved static external IP
- Supabase remains the primary database and storage layer
- provider secrets live in the AI Gateway runtime, not in the frontend

## Current Product Scope

Implemented today:

- Telegram webhook with secret validation
- Telegram Mini App auth bootstrap via verified Telegram `initData`
- Provider catalog backed by PostgreSQL
- Persisted users, chats, messages, files, subscriptions, generation jobs, and provider usage
- Provider abstraction for OpenAI, Anthropic, Gemini, and Nano Banana
- Provider orchestration and fallback/retry seams
- Interactive chat execution through orchestration
- Async job records and polling API for generation flows
- Subscription gating with token balance tracking
- Pluggable file storage adapter with Supabase Storage support
- Request correlation and structured JSON logging
- AI Gateway with validation, internal auth, timeout, retry, error mapping, and provider usage extraction
- RU / EN frontend localization with Russian as default

Not fully implemented yet:

- real billing provider integration
- streaming assistant responses
- external queue worker infrastructure
- distributed rate limiting
- production malware scanning / content inspection for uploads
- full infrastructure-as-code for GCP resources

## Repository Structure

```text
.
├── AGENTS.md
├── README.md
├── .env.example
├── package.json
├── ai-gateway
│   ├── Dockerfile
│   ├── .env.example
│   ├── README.md
│   └── src
│       ├── app.ts
│       ├── env.ts
│       ├── lib
│       ├── middleware
│       ├── modules
│       │   ├── anthropic
│       │   ├── gateway
│       │   ├── google
│       │   └── openai
│       └── routes
├── backend
│   ├── Dockerfile
│   ├── package.json
│   ├── prisma
│   │   ├── migrations
│   │   ├── schema.prisma
│   │   └── seed.ts
│   └── src
│       ├── app.ts
│       ├── env.ts
│       ├── index.ts
│       ├── worker.ts
│       ├── lib
│       ├── middleware
│       └── modules
│           ├── auth
│           ├── catalog
│           ├── chats
│           ├── files
│           ├── jobs
│           ├── orchestration
│           ├── providers
│           ├── subscriptions
│           ├── telegram
│           ├── usage
│           └── users
├── docs
│   ├── deployment
│   ├── migration
│   └── validation
└── frontend
    ├── index.html
    ├── package.json
    └── src
        ├── app
        ├── components
        ├── hooks
        ├── lib
        ├── pages
        └── styles
```

## Backend Responsibilities

- `auth`: Telegram Mini App bootstrap, session issuance, auth middleware support
- `telegram`: webhook handling and bot-facing message behavior
- `catalog`: provider catalog read API and provider presentation data
- `chats`: chat lifecycle, message persistence, subscription gating, orchestration entrypoint for interactive flows
- `files`: upload validation and storage adapter integration
- `providers`: provider contracts, adapters, gateway client, registry, normalized results, and error mapping
- `orchestration`: provider execution decisions, capability checks, fallback/retry policy, structured provider call logging
- `jobs`: async generation job persistence, queue abstraction, and status polling API
- `subscriptions`: plan state, token balance, entitlement gating, dev activation helpers
- `usage`: normalized provider usage persistence
- `users`: authenticated current-user read API

Provider APIs are never called directly from routes. In production, backend provider adapters call the AI Gateway through `AI_GATEWAY_URL`; direct upstream calls remain only as local/development fallback where supported.

## AI Gateway Responsibilities

The AI Gateway is an internal service, not a public proxy.

It owns:

- provider API credentials
- provider-specific upstream HTTP requests
- request validation with `zod`
- internal bearer auth from backend to gateway
- timeout and retry policy for provider transport
- upstream error classification and safe normalized responses
- upstream request id capture
- usage extraction where providers return usage
- structured logs with request id, provider, model, region, egress mode, latency, retry count, and upstream status

Gateway API:

```text
GET /health
GET /ready
POST /v1/providers/:provider/chat/respond
POST /v1/providers/:provider/jobs/execute
POST /v1/chat/respond
```

## Setup

### Prerequisites

- Node.js 20+
- npm 10+
- PostgreSQL 15+ or Supabase Postgres
- a Telegram bot created via BotFather
- API keys for OpenAI, Anthropic, and Google AI
- Google Cloud SDK for production deployment

### Install

```bash
npm install
```

### Configure Env Vars

Copy `.env.example` to `.env` and fill in local values.

Important backend variables:

- `DATABASE_URL`: runtime PostgreSQL connection string
- `DIRECT_URL`: direct PostgreSQL connection string for Prisma CLI commands
- `FRONTEND_URL`: frontend origin allowed by backend CORS
- `API_BASE_URL`: public backend URL
- `AI_GATEWAY_URL`: internal/public Cloud Run URL of the AI Gateway
- `AI_GATEWAY_INTERNAL_TOKEN`: shared backend-to-gateway bearer token
- `TELEGRAM_BOT_TOKEN`: BotFather token
- `TELEGRAM_WEBHOOK_SECRET`: secret token used for Telegram webhook validation
- `TELEGRAM_MINI_APP_URL`: public Mini App URL
- `UPLOAD_STORAGE_DRIVER`: `local` or `supabase`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`: required for Supabase-backed file storage

Important gateway variables:

- `AI_GATEWAY_INTERNAL_TOKEN`: same shared token used by the backend
- `GATEWAY_REGION`: expected gateway region, normally `asia-southeast1`
- `GATEWAY_EGRESS_MODE`: `default` or `cloud-nat-static-ip`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_AI_API_KEY`
- provider default model and retry/timeout settings

Frontend-visible variables must stay under `VITE_*`.

No provider secrets or gateway tokens belong in frontend env.

## Database Setup

Generate Prisma client, apply migrations, and seed the provider catalog:

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

Production migrations should be run as an explicit operator step, not during Cloud Run startup:

```bash
DATABASE_URL="<DIRECT_OR_MIGRATION_DATABASE_URL>" \
DIRECT_URL="<DIRECT_OR_MIGRATION_DATABASE_URL>" \
npm run db:deploy --workspace backend
```

Supabase connection split:

- `DATABASE_URL`: pooled/runtime connection string
- `DIRECT_URL`: direct connection for Prisma CLI and migrations

## Run Locally

Run backend and frontend:

```bash
npm run dev
```

Run services independently:

```bash
npm run dev:backend
npm run dev:gateway
npm run dev:frontend
```

Default local URLs:

- frontend: `http://localhost:5173`
- backend: `http://localhost:8787`
- gateway: `http://localhost:8080`

Run tests:

```bash
npm run test
```

Run checks:

```bash
npm run lint
npm run build
```

## Deployment Map

Use these docs for production rollout:

- [GCP backend Cloud Run deployment](docs/deployment/gcp-backend-cloud-run.md)
- [GCP AI Gateway Cloud Run deployment](docs/deployment/gcp-ai-gateway-cloud-run.md)
- [GCP static egress in Singapore](docs/deployment/gcp-static-egress-singapore.md)
- [Cloudflare Worker to GCP Cloud Run migration](docs/migration/cloudflare-worker-to-gcp-cloud-run.md)
- [Smoke-test and validation checklist](docs/validation/smoke-test-checklist.md)
- [AI Gateway README](ai-gateway/README.md)

High-level order:

1. Build and deploy AI Gateway to Cloud Run in `asia-southeast1`.
2. Configure VPC connector, Cloud NAT, and reserved static egress IP for the gateway.
3. Verify gateway `/health` returns `egressMode: "cloud-nat-static-ip"`.
4. Build and deploy backend to Cloud Run.
5. Set backend `AI_GATEWAY_URL` and `AI_GATEWAY_INTERNAL_TOKEN`.
6. Run migrations against Supabase through `DIRECT_URL` if needed.
7. Update Cloudflare Pages `VITE_API_BASE_URL` to the GCP backend.
8. Set Telegram webhook to the GCP backend.
9. Run the smoke-test checklist.

## Security Notes

- Telegram webhook requests are validated with a secret token.
- Telegram Mini App auth is verified server-side.
- Gateway non-health endpoints require internal bearer auth.
- Uploads are MIME- and size-restricted.
- Signed backend sessions are time-limited.
- Provider secrets live in the AI Gateway runtime.
- Frontend never receives provider secrets or gateway auth.
- Structured logs avoid secrets and raw credentials.
- Authorization checks apply to chats, files, jobs, and subscriptions.

## Observability And Reliability

Implemented today:

- request id / correlation id per inbound backend and gateway request
- structured JSON logging
- normalized provider error mapping
- timeout handling for provider transport
- retryability classification on provider failures
- usage persistence separate from logs
- gateway logs include `gatewayRegion` and `gatewayEgressMode`

Raw upstream errors are not exposed to clients. Client-facing provider failures are mapped to safe messages such as:

- provider busy
- provider timed out
- provider unavailable
- generic provider request failure

## Adding New Capabilities

### Add A Provider

1. Seed provider metadata in `backend/prisma/seed.ts` if the catalog needs it.
2. Add or update an adapter file in `backend/src/modules/providers`.
3. Register the adapter in `provider-registry.ts`.
4. Add gateway transport support under `ai-gateway/src/modules/<provider>`.
5. Expose capability metadata and normalized usage extraction.
6. Add orchestration policy for execution mode, fallback, and retries.
7. Add tests for gateway success, retryable failure, non-retryable failure, and empty response.

### Add A Slow Async Provider

1. Expose `supportsAsyncJobs`.
2. Add orchestration policy for `async_job`.
3. Persist the job through the jobs module.
4. Implement gateway job execution or callback support.
5. Connect real queue infrastructure behind `GenerationJobQueue`.
6. Write completion/failure back into `GenerationJob` and `ProviderUsage`.

## Future Improvements

- implement real queue workers for async providers
- add streaming execution mode end to end
- replace the in-memory rate limiter
- add production malware scanning / content inspection
- add admin tooling for provider enablement and plan management
- add infrastructure-as-code once the manual GCP deployment stabilizes
