# Iishka AI Hub

## Overview
Iishka AI Hub is a Telegram AI aggregation product with two user surfaces:

- a Telegram bot that handles discovery and opens the Mini App
- a Telegram Mini App that lets a user browse providers, manage subscription state, and run provider-specific conversations

The repository is a modular monolith with a strict package split:

- `frontend`: React + Vite + TypeScript Mini App
- `backend`: Hono + TypeScript + Prisma API and Telegram bot backend

The current provider set is:

- OpenAI / ChatGPT
- Anthropic / Claude
- Google / Gemini

The backend has been refactored around orchestration, jobs, usage accounting, and provider isolation so we can add slower providers such as video and music generators without rewriting the whole system.

## Current product scope
Implemented today:

- Telegram webhook with secret validation
- Telegram Mini App auth bootstrap via verified Telegram `initData`
- Provider catalog backed by PostgreSQL
- Persisted chats, messages, files, subscriptions, generation jobs, and provider usage
- Provider abstraction for OpenAI, Anthropic, and Gemini
- Interactive chat execution through orchestration
- Async job records and polling API for long-running generation flows
- Subscription gating with token balance tracking
- Pluggable file storage adapter
- Request correlation and structured logging
- RU / EN frontend localization with Russian as default

Not fully implemented yet:

- Real billing provider integration
- Streaming assistant responses
- External queue worker infrastructure
- Provider fallback policy execution beyond structured seams
- Distributed rate limiting
- Production malware scanning / content inspection for uploads

## Architecture
### Repository structure
```text
.
├── AGENTS.md
├── README.md
├── .env.example
├── package.json
├── backend
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

### Backend module responsibilities
- `auth`: Telegram Mini App bootstrap, session issuance, auth middleware support
- `telegram`: webhook handling and bot-facing message behavior
- `catalog`: provider catalog read API and provider presentation data
- `chats`: chat lifecycle, message persistence, subscription gating, orchestration entrypoint for interactive flows
- `files`: upload validation and storage adapter integration
- `providers`: provider contracts, adapters, registry, normalized results, and upstream error mapping
- `orchestration`: provider execution decisions, capability checks, execution mode selection, structured provider call logging
- `jobs`: async generation job persistence, queue abstraction, and status polling API
- `subscriptions`: plan state, token balance, entitlement gating, dev activation helpers
- `usage`: normalized provider usage persistence
- `users`: authenticated current-user read API

### Cross-cutting backend primitives
These responsibilities are implemented today in `backend/src/lib` and `backend/src/middleware`:

- structured logging via `lib/logger.ts`
- request correlation via `lib/request-context.ts` and `middleware/request-id.ts`
- shared error types and safe response mapping via `lib/errors.ts` and `lib/http.ts`
- Prisma client access via `lib/prisma.ts`
- auth context enrichment in `middleware/auth.ts`

### Execution model
The backend now has two explicit execution paths:

- interactive path
  - used for text chat and other low-latency provider operations
  - handled by `chats` -> `orchestration` -> `providers`
- async job path
  - used for long-running generation work such as future video and music providers
  - handled by `jobs` with queueing abstracted behind an interface

Provider adapters expose execution mode and capability metadata so orchestration can decide whether to:

- await the response synchronously
- stream in the future
- queue a generation job

### Provider architecture
Provider APIs are never called directly from routes.

Each provider adapter is responsible for:

- auth and request construction
- response extraction
- usage extraction
- upstream request id capture
- timeout handling
- retryability classification
- upstream error mapping into normalized provider errors

The provider registry exposes structured provider metadata, including capability flags such as:

- `supportsText`
- `supportsImage`
- `supportsStreaming`
- `supportsAsyncJobs`
- `supportsFiles`

### Extension points
The current codebase is prepared for the next layer of production features without requiring a rewrite:

- add a new provider by implementing the provider contract and registering it in `provider-registry.ts`
- add a slow provider by exposing `supportsAsyncJobs` and routing it through the jobs module
- replace the default logging queue with Redis, SQS, Cloud Tasks, Durable Objects, or another backend queue
- replace local or Supabase-backed file storage with another object storage adapter
- add fallback and retry execution policy inside orchestration without changing route handlers
- add richer usage/billing logic inside `usage` and `subscriptions`

## Prisma data model
The persistence model currently includes:

- `User`: Telegram identity and profile metadata
- `Provider`: provider catalog and default model metadata
- `Chat`: user-owned provider-scoped conversation container
- `Message`: persisted chat history with completion and failure state
- `FileAsset`: validated upload record
- `MessageAttachment`: join table for message-file relationships
- `Subscription`: plan state and token allowance / consumption
- `GenerationJob`: long-running generation lifecycle record
- `ProviderUsage`: normalized provider usage and latency record

This keeps product data decoupled from provider-native payload formats while preserving enough metadata for debugging and accounting.

## API surface
Current route groups mounted from `backend/src/app.ts`:

- `/api/auth`
- `/api/me`
- `/api/catalog`
- `/api/chats`
- `/api/files`
- `/api/jobs`
- `/api/subscription`
- `/api/telegram`

`app.ts` is intentionally limited to app composition, shared middleware, health endpoints, and route mounting.

## Setup
### Prerequisites
- Node.js 20+
- npm 10+
- PostgreSQL 15+ or Supabase Postgres
- a Telegram bot created via BotFather
- API keys for OpenAI, Anthropic, and Google AI

### Install
```bash
npm install
```

### Configure env vars
Copy `.env.example` to `.env` and fill in real values.

Important variables:

- `DATABASE_URL`: runtime PostgreSQL connection string
- `DIRECT_URL`: direct PostgreSQL connection string for Prisma CLI commands
- `FRONTEND_URL`: frontend origin allowed by backend CORS
- `API_BASE_URL`: public backend URL
- `TELEGRAM_BOT_TOKEN`: BotFather token
- `TELEGRAM_WEBHOOK_SECRET`: secret token used for Telegram webhook validation
- `TELEGRAM_MINI_APP_URL`: public Mini App URL
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY`: provider credentials
- `UPLOAD_STORAGE_DRIVER`: `local` or `supabase`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`: required for Supabase-backed file storage
- `ENABLE_DEV_AUTH`: local non-Telegram auth bootstrap
- `ENABLE_DEV_SUBSCRIPTION_OVERRIDE`: local/dev subscription activation shortcut
- `OPENAI_BASE_URL`, `OPENAI_PROXY_SHARED_SECRET`: optional seam for a future non-Cloudflare OpenAI proxy

Frontend-visible variables must stay under `VITE_*`.

## Database setup
Generate Prisma client, apply migrations, and seed the provider catalog:

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

For production-safe schema changes, use generated Prisma migrations and keep changes additive where possible.

### Supabase notes
Supabase works well as:

- managed Postgres
- upload storage backend

Recommended connection split:

- `DATABASE_URL`: pooled/runtime connection string
- `DIRECT_URL`: direct connection for Prisma CLI and migrations

## Run locally
Run both apps:

```bash
npm run dev
```

Run each side independently:

```bash
npm run dev:backend
npm run dev:frontend
```

Run backend tests:

```bash
npm run test
```

Default local URLs:

- frontend: `http://localhost:5173`
- backend: `http://localhost:8787`

### Local development without Telegram
When Telegram `initData` is unavailable and `VITE_ENABLE_DEV_AUTH=true`, the frontend can bootstrap through a dev auth path. This gives a local signed backend session and keeps the Mini App flow testable without Telegram.

## Telegram integration
### Webhook
Telegram posts to:

```text
POST /api/telegram/webhook
```

The backend validates:

- the configured secret header
- Mini App auth signatures during frontend bootstrap

### Mini App bootstrap
The Mini App calls:

```text
POST /api/auth/telegram/bootstrap
```

The backend:

- verifies Telegram `initData`
- upserts the user
- ensures a subscription record exists
- returns a signed backend session

## Jobs and async generation
The jobs module exists now even though external queue infrastructure is still abstracted.

Current behavior:

- `POST /api/jobs` creates a `GenerationJob`
- the queue seam receives an enqueue call through `GenerationJobQueue`
- `GET /api/jobs` and `GET /api/jobs/:jobId` expose status polling

The default queue implementation is intentionally lightweight and replaceable.

## Observability and reliability
Implemented today:

- request id / correlation id per inbound request
- structured JSON logging
- normalized provider error mapping
- timeout handling for upstream providers
- retryability classification on provider failures
- usage persistence separate from logs

Raw upstream errors are not exposed to clients. Client-facing provider failures are mapped to safe messages such as:

- provider busy
- provider timed out
- provider unavailable in the current deployment region
- generic provider request failure

## Deployment notes
### Recommended Cloudflare path
- frontend -> Cloudflare Pages
- backend -> Cloudflare Workers
- database -> Supabase Postgres
- uploads -> Supabase Storage
- Telegram delivery -> webhook in production

Relevant backend deployment files:

- [backend/wrangler.jsonc](/Users/artemveselov/Projects/iishka_service/backend/wrangler.jsonc)
- [backend/src/worker.ts](/Users/artemveselov/Projects/iishka_service/backend/src/worker.ts)
- [backend/.dev.vars.example](/Users/artemveselov/Projects/iishka_service/backend/.dev.vars.example)

High-level production steps:

1. `npm install`
2. `npm run db:generate`
3. configure Worker secrets and vars
4. `npm run deploy:backend`
5. deploy `frontend/dist` to Pages
6. register Telegram webhook against the Worker public URL

### Recommended production swaps
- local/in-memory rate limiter -> distributed limiter
- local file storage -> managed object storage
- dev auth -> disabled
- dev subscription override -> disabled
- default logging queue -> real queue / worker infrastructure for async jobs

## Security notes
- Telegram webhook requests are validated with a secret token
- Telegram Mini App auth is verified server-side
- uploads are MIME- and size-restricted
- signed backend sessions are time-limited
- provider secrets remain backend-only
- structured logs avoid secrets and raw credentials
- authorization checks apply to chats, files, and jobs

## Adding new capabilities
### Add a provider
1. Seed provider metadata in `backend/prisma/seed.ts` if the catalog needs it
2. Add an adapter file in `backend/src/modules/providers`
3. Register the adapter in `provider-registry.ts`
4. Expose capability metadata and normalized usage extraction
5. Add orchestration policy for execution mode, fallback, and future retries

### Add a slow async provider
1. expose `supportsAsyncJobs`
2. add orchestration policy for `async_job`
3. persist the job through the jobs module
4. connect real queue infrastructure behind `GenerationJobQueue`
5. write completion/failure back into `GenerationJob` and `ProviderUsage`

### Add product metering or billing
1. evolve `subscriptions` for entitlements
2. persist normalized usage via `usage`
3. keep provider-native billing details out of the core product schema

## Documentation map
- [AGENTS.md](/Users/artemveselov/Projects/iishka_service/AGENTS.md): architecture rules and contribution guidance
- [backend/prisma/schema.prisma](/Users/artemveselov/Projects/iishka_service/backend/prisma/schema.prisma): current persistence model
- [backend/src/app.ts](/Users/artemveselov/Projects/iishka_service/backend/src/app.ts): route composition and middleware

## Future improvements
- implement real queue workers for async providers
- add streaming execution mode end to end
- add explicit fallback policy execution in orchestration
- replace the in-memory rate limiter
- add admin tooling for provider enablement and plan management
- add integration tests for auth bootstrap, jobs lifecycle, and provider failure mapping
