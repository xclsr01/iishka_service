# Build Telegram AI Subscription MVP Context

## Source of truth
This context is distilled from:

- `AGENTS.md`
- `README.md`
- current workspace state on branch `wip3`

## Product goal
Build a secure MVP Telegram product with:

- a Telegram bot that handles `/start`
- a Telegram Mini App for browsing providers and chatting
- multiple AI providers behind one subscription

Current provider scope:

- OpenAI / ChatGPT
- Anthropic / Claude
- Google / Gemini

## Architecture constraints
- Keep `frontend` and `backend` separated at the package boundary.
- Keep the backend as a modular monolith under `backend/src/modules/<domain>`.
- Keep provider-specific logic inside `backend/src/modules/providers`.
- Keep route handlers thin and move orchestration into services.
- Keep storage behind an adapter so local disk can later be replaced by object storage.
- Keep Telegram webhook behavior in `backend/src/modules/telegram`.
- Keep Telegram Mini App auth and session issuance in `backend/src/modules/auth`.

## Backend shape
- `backend/src/app.ts`: app composition and route mounting
- `backend/src/env.ts`: env parsing and runtime config policy
- `backend/src/modules/auth`: Telegram Mini App bootstrap and session issuance
- `backend/src/modules/catalog`: provider catalog read API
- `backend/src/modules/chats`: chat lifecycle, persistence, subscription gating, provider orchestration
- `backend/src/modules/files`: upload validation and storage adapters
- `backend/src/modules/providers`: AI provider abstraction and adapters
- `backend/src/modules/subscriptions`: subscription state and future billing seam
- `backend/src/modules/telegram`: bot webhook behavior

## Frontend shape
- React + Vite + TypeScript CSR Mini App
- `frontend/src/lib/api.ts`: API client
- `frontend/src/lib/telegram.ts`: Telegram browser integration
- `frontend/src/hooks/use-bootstrap.ts`: bootstrap flow
- `frontend/src/pages/home-page.tsx`: provider browse screen
- `frontend/src/pages/chat-page.tsx`: provider-specific chat screen

## MVP scope
Implemented foundation:

- Telegram bot webhook with secret validation
- Telegram Mini App bootstrap with Telegram `initData`
- signed backend session issuance
- provider catalog and provider-specific chats
- persisted users, providers, chats, messages, subscriptions, and files
- file uploads with validation
- dev-only bootstrap and dev subscription activation

Explicitly not complete yet:

- real billing integration
- streaming responses
- production-grade distributed rate limiting
- advanced provider-native file pipelines
- background jobs and moderation pipelines

## Security rules
- Never trust Telegram webhook payloads without validating `TELEGRAM_WEBHOOK_SECRET`.
- Never trust Mini App auth without verifying Telegram `initData`.
- Never expose raw upstream provider errors directly to clients.
- Never accept uploads without MIME and size validation.
- Keep secrets only in env vars.
- Disable dev auth and dev subscription overrides outside local development.

## Local and deployment model
Local development:

- root `.env` is shared for `npm run dev:backend` and `npm run dev:frontend`
- `backend/.env` can override backend-only local Node settings
- `backend/.dev.vars` is for `wrangler dev` only

Cloudflare deployment path:

- frontend -> Cloudflare Pages
- backend -> Cloudflare Workers
- database -> Supabase Postgres
- uploads -> Supabase Storage

Config split:

- `backend/wrangler.jsonc` is the production Worker config for non-secret values
- `backend/.dev.vars` is local Worker-only configuration

## Current branch context
Branch:

- `wip3`

Last known committed base:

- `c812809` (`Merge pull request #3 from xclsr01/wip2`)

Current uncommitted work in this workspace:

1. Mini App bootstrap UX improvement when the frontend is opened outside Telegram.
2. Cloudflare config split so local Worker development is separated from production Worker settings.

## Current WIP details
Mini App bootstrap WIP:

- backend root route added for a simple JSON status response
- frontend bootstrap now shows a specific "Open In Telegram" state when Telegram session data is unavailable in a standalone browser
- this is meant to make deployed smoke checks clearer when opening the raw `pages.dev` URL outside Telegram

Cloudflare config split WIP:

- `backend/wrangler.jsonc` now reflects production URLs and production-safe non-secret defaults
- `backend/.dev.vars.example` now reflects local Worker development values
- `backend/src/load-local-env.ts` loads dotenv only for the Node entrypoint
- `backend/src/index.ts` imports that local env loader
- `backend/src/env.ts` no longer eagerly loads dotenv for Worker runs
- `.gitignore` now ignores `backend/.dev.vars*` except the example file

## Known gaps
- Backend lint currently fails because `backend/tsconfig.json` includes `prisma/seed.ts` while `rootDir` is `src`.
- The current branch still has uncommitted changes.
- Cloudflare may still show a drift warning until the Worker is deployed once from Wrangler with the updated production config.

## Working conventions
- Use TypeScript with strict typing.
- Validate external inputs with `zod`.
- Do not call provider APIs directly from routes.
- Do not mix frontend concerns into Prisma models or backend DTOs.
- Keep comments short and only for non-obvious behavior.

## Useful commands
```bash
npm run dev
npm run dev:backend
npm run dev:frontend
npm run dev:backend:worker
npm run db:generate
npm run db:migrate
npm run db:seed
npm run test
```
