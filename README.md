# Iishka AI Hub MVP

## Overview
Iishka AI Hub is an MVP Telegram product made of two surfaces:

- A Telegram bot that handles the `/start` entrypoint and opens the Mini App
- A Telegram Mini App that lets a subscribed user browse providers, open a provider-specific chat, upload files, and continue conversations with persisted history

The MVP aggregates three AI providers behind one subscription model:

- ChatGPT / OpenAI
- Claude / Anthropic
- Gemini / Google

The repository is structured as a modular monolith with separate frontend and backend applications.

## MVP scope
Included in this foundation:

- Telegram bot webhook with secret validation
- Telegram Mini App bootstrap using Telegram `initData`
- React + Vite + TypeScript frontend with mobile-first CSR UI
- Hono + TypeScript backend with Prisma persistence
- Provider abstraction for OpenAI, Anthropic, and Gemini
- Database-backed users, providers, chats, messages, subscriptions, and files
- Multipart file uploads with validation and local storage adapter
- Subscription-gated messaging flow
- Dev-only bootstrap and subscription activation paths for local development

Not fully implemented in MVP:

- Real billing provider integration
- Advanced provider-native file reasoning pipelines
- Streaming responses
- Background jobs and async moderation pipelines
- Production-grade distributed rate limiting

## Architecture
### Folder structure
```text
.
├── AGENTS.md
├── README.md
├── .env.example
├── package.json
├── tsconfig.base.json
├── backend
│   ├── package.json
│   ├── prisma
│   │   ├── schema.prisma
│   │   └── seed.ts
│   └── src
│       ├── app.ts
│       ├── env.ts
│       ├── index.ts
│       ├── lib
│       ├── middleware
│       ├── modules
│       │   ├── auth
│       │   ├── catalog
│       │   ├── chats
│       │   ├── files
│       │   ├── providers
│       │   ├── subscriptions
│       │   ├── telegram
│       │   └── users
│       └── types.ts
└── frontend
    ├── index.html
    ├── package.json
    ├── tailwind.config.ts
    ├── vite.config.ts
    └── src
        ├── app
        ├── components
        ├── hooks
        ├── lib
        ├── pages
        └── styles
```

### Backend design
- `backend/src/app.ts` builds the Hono app and mounts all routes under `/api`
- `backend/src/modules/providers` contains the provider abstraction layer so new AI vendors can be added without touching chat routes
- `backend/src/modules/chats` owns chat and message orchestration, including subscription checks and provider calls
- `backend/src/modules/files` owns upload validation, checksum generation, and storage adapter integration
- `backend/src/modules/telegram` handles the bot webhook and message dispatch
- `backend/src/modules/auth` verifies Telegram Mini App auth and issues signed backend sessions

### Frontend design
- CSR React app with provider browse screen and provider-specific chat screen
- API client layer under `frontend/src/lib/api.ts`
- Reusable UI primitives under `frontend/src/components/ui`
- Telegram Mini App bootstrap in `frontend/src/hooks/use-bootstrap.ts`

### Cloudflare-friendly direction
The backend avoids vendor SDK lock-in for AI providers and talks to upstream APIs via `fetch`. Request handling is Hono-native and mostly runtime-agnostic. For local MVP operation, Prisma and local disk uploads are used. For Cloudflare-oriented deployment, swap:

- local upload adapter -> R2/S3-compatible adapter
- direct Postgres -> Prisma Accelerate or a containerized runtime close to the database
- in-memory rate limiting -> Redis/KV/Durable Object backed limiter

## Prisma data model
The MVP persistence model is:

- `User`: Telegram identity, profile fields, timestamps
- `Provider`: catalog of enabled AI providers and default model metadata
- `Chat`: user-owned chat container scoped to one provider
- `Message`: ordered chat history entries with assistant failure support
- `FileAsset`: validated uploaded files with MIME, size, checksum, and storage key
- `MessageAttachment`: many-to-many join from messages to uploaded files
- `Subscription`: replaceable subscription record with plan code, lifecycle state, and external reference slot

This supports:

- multiple providers per user
- multiple chats per provider
- persisted message history
- file attachment reuse
- mocked billing today, real billing later

## Setup
### Prerequisites
- Node.js 20+
- npm 10+
- PostgreSQL 15+
- A Telegram bot created via BotFather
- API keys for OpenAI, Anthropic, and Google AI Studio

### Install
```bash
npm install
```

### Configure env vars
Copy `.env.example` to `.env` in the repository root and fill in real values.

Key points:

- The backend reads root env variables directly
- The frontend requires `VITE_*` variables from the same root `.env`
- `JWT_SECRET` should be a long random secret
- `DEV_AUTH_SHARED_SECRET` and `VITE_DEV_AUTH_SHARED_SECRET` should match for local development

## Env vars
Important variables:

- `DATABASE_URL`: PostgreSQL connection string
- `DIRECT_URL`: direct PostgreSQL connection string for Prisma migrations
- `FRONTEND_URL`: allowed CORS origin for the Mini App frontend
- `API_BASE_URL`: backend URL
- `VITE_API_BASE_URL`: frontend-visible backend URL
- `TELEGRAM_BOT_TOKEN`: bot token from BotFather
- `TELEGRAM_WEBHOOK_SECRET`: secret token configured when registering Telegram webhook
- `TELEGRAM_MINI_APP_URL`: public frontend URL used in the bot button
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY`: upstream provider credentials
- `MAX_UPLOAD_BYTES`, `ALLOWED_UPLOAD_MIME_TYPES`: upload safety policy
- `UPLOAD_STORAGE_DRIVER`: `local` or `supabase`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`: required when using Supabase Storage
- `ENABLE_DEV_AUTH`, `VITE_ENABLE_DEV_AUTH`: local non-Telegram bootstrap toggle
- `ENABLE_DEV_SUBSCRIPTION_OVERRIDE`: allows demo subscription activation for local testing

## Database setup
Generate the Prisma client, run migrations, and seed the provider catalog:

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

If you are starting from scratch, create the database before running migrations.

### Supabase setup
Supabase works well for this project as:

- hosted Postgres for the main app database
- Storage for uploaded files

Recommended connection string split:

- `DATABASE_URL`: use the Supabase pooled connection string for runtime traffic
- `DIRECT_URL`: use the direct/session connection string for Prisma CLI commands such as `migrate`

Recommended storage setup:

1. Create a Supabase project
2. Create a Storage bucket, for example `chat-uploads`
3. Set:
   ```env
   UPLOAD_STORAGE_DRIVER=supabase
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
   SUPABASE_STORAGE_BUCKET=chat-uploads
   ```

Important:

- Keep `SUPABASE_SERVICE_ROLE_KEY` on the backend only
- Do not expose the service role key to the frontend
- The backend uploads server-side, so the browser never needs Supabase secrets

## Run instructions
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

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8787`

### Local development without Telegram
The frontend will use `POST /api/auth/dev/bootstrap` when Telegram `initData` is unavailable and `VITE_ENABLE_DEV_AUTH=true`.

This gives you:

- a seeded local user
- the provider catalog
- a signed backend session
- an inactive subscription until you activate the demo subscription

## Telegram integration notes
### Bot behavior
The bot webhook endpoint is:

```text
POST /api/telegram/webhook
```

It expects the header:

```text
x-telegram-bot-api-secret-token: <TELEGRAM_WEBHOOK_SECRET>
```

On `/start`, the bot sends a message with an inline `web_app` button pointing to `TELEGRAM_MINI_APP_URL`.

### Register webhook
Example Telegram webhook registration:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-backend.example.com/api/telegram/webhook",
    "secret_token": "your-webhook-secret"
  }'
```

### Mini App auth
The Mini App bootstraps by sending Telegram `initData` to:

```text
POST /api/auth/telegram/bootstrap
```

The backend verifies the Telegram signature, upserts the user, ensures a subscription record exists, and returns a signed app session token.

## Deployment notes
### Frontend
- Deploy the Vite build to a static host
- Ensure the deployed origin matches `TELEGRAM_MINI_APP_URL`
- Keep `VITE_API_BASE_URL` pointed at the backend public URL

### Backend
- Deploy as a container or serverless-compatible Hono target
- Use a managed PostgreSQL database
- Replace local file storage with object storage before production
- If targeting Cloudflare-adjacent infrastructure, use a Prisma strategy compatible with your runtime

### Cloudflare deployment path
Recommended setup for this repository:

- Frontend -> Cloudflare Pages
- Backend -> Cloudflare Workers
- Database -> Supabase Postgres
- Uploads -> Supabase Storage
- Telegram delivery -> `webhook` in production, `polling` only for local development

Backend Cloudflare files are in:

- [backend/wrangler.jsonc](/Users/artemveselov/Projects/iishka_service/backend/wrangler.jsonc)
- [backend/src/worker.ts](/Users/artemveselov/Projects/iishka_service/backend/src/worker.ts)
- [backend/.dev.vars.example](/Users/artemveselov/Projects/iishka_service/backend/.dev.vars.example)

Config split:

- `backend/wrangler.jsonc` is the production Worker config and should stay aligned with the deployed Worker's non-secret settings
- `backend/.dev.vars` is for `wrangler dev` only and should contain local overrides such as `APP_ENV=development`, localhost URLs, and dev auth toggles
- Root `.env` remains the shared local file for `npm run dev:backend` and `npm run dev:frontend`

Production deployment checklist:

1. Install dependencies:
   ```bash
   npm install
   ```
2. Generate Prisma client:
   ```bash
   npm run db:generate
   ```
3. Login to Cloudflare:
   ```bash
   cd backend
   npx wrangler login
   ```
4. Keep `backend/wrangler.jsonc` set to the production public URLs and non-secret defaults
5. Set `DATABASE_URL` to the Supabase pooled connection string
6. Set `DIRECT_URL` to the Supabase direct connection string for Prisma CLI usage
7. Set `UPLOAD_STORAGE_DRIVER=supabase`
8. Set `SUPABASE_SERVICE_ROLE_KEY` as a Worker secret
9. Set any remaining sensitive backend credentials as Worker secrets instead of committing them to `wrangler.jsonc`
10. Deploy backend:
   ```bash
   npm run deploy:backend
   ```
11. Deploy frontend by building `frontend/dist` to Cloudflare Pages
12. Register the Telegram webhook against the Worker public URL:
   ```bash
   curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{
       "url": "https://<your-worker-domain>/api/telegram/webhook",
       "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
     }'
   ```

Local Worker development:

1. Copy `backend/.dev.vars.example` to `backend/.dev.vars`
2. Set local-only values such as `APP_ENV=development`, localhost URLs, and `ENABLE_DEV_AUTH=true`
3. Run:
   ```bash
   npm run dev:backend:worker
   ```

If Wrangler says the deployed Worker config differs from the local config, that is a deploy-time drift warning from Cloudflare, not an application crash. Validate the diff, then deploy once from Wrangler to make the repo config the source of truth and clear stale dashboard-only vars such as old `VITE_*` entries from the Worker.

### Recommended production swaps
- `LocalStorageAdapter` -> Supabase Storage or R2/S3 adapter
- in-memory rate limiter -> Redis/KV/Durable Object backed limiter
- dev auth routes -> disabled
- dev subscription override -> disabled

## Security notes
- Telegram Mini App bootstrap is HMAC-verified using the bot token
- Telegram webhook requests are validated with a secret token header
- All API input is validated with `zod`
- Signed backend session tokens are HMAC-protected and time-limited
- Uploads are restricted by MIME type and max size
- File names are sanitized and stored by generated storage key
- Error responses avoid exposing stack traces or internals
- Rate limiting exists as an MVP extension point and should be replaced with distributed infrastructure in production

## Future improvements
- Add Stripe, Telegram Stars, or another billing adapter behind the current subscription domain
- Add streaming assistant responses with SSE or WebSockets
- Introduce provider-native file parsing and per-provider multimodal request builders
- Support usage metering, quotas, and plan entitlements
- Add background jobs for transcription, OCR, antivirus scanning, and moderation
- Add admin tooling for provider enablement and plan management
- Add integration tests for Telegram bootstrap, subscription gating, and provider adapters
