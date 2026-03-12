# AGENTS.md

## Project goals
- Build a secure MVP Telegram bot + Telegram Mini App that aggregates multiple AI providers behind one subscription
- Keep the codebase practical, modular, and easy to extend without splitting into microservices
- Preserve a clear separation between frontend and backend concerns
- Optimize for a developer being able to clone, configure env vars, run locally, and connect Telegram quickly

## Architecture rules
- Keep `/frontend` and `/backend` separated at the package boundary
- Treat the backend as a modular monolith: domains live in `backend/src/modules/<domain>`
- Keep provider-specific logic behind the provider adapter layer in `backend/src/modules/providers`
- Do not call provider APIs directly from routes; routes delegate to services
- Keep storage behind an adapter so local disk can be replaced by object storage
- Put Telegram-specific webhook and bootstrap logic in `backend/src/modules/telegram` and `backend/src/modules/auth`
- Avoid leaking frontend concerns into Prisma models or backend transport DTOs

## Folder responsibilities
- `/backend/prisma`: schema, migrations, seeds
- `/backend/src/app.ts`: app composition and route mounting
- `/backend/src/env.ts`: env parsing and runtime config policy
- `/backend/src/lib`: shared backend primitives such as auth, error mapping, logging, and Prisma
- `/backend/src/middleware`: request-scoped cross-cutting concerns
- `/backend/src/modules/auth`: Telegram Mini App bootstrap and session issuance
- `/backend/src/modules/catalog`: provider catalog read API
- `/backend/src/modules/chats`: chat lifecycle, persistence, provider orchestration
- `/backend/src/modules/files`: upload validation and storage adapters
- `/backend/src/modules/providers`: provider abstraction and vendor adapters
- `/backend/src/modules/subscriptions`: subscription state, gating, future billing adapter seam
- `/backend/src/modules/telegram`: Telegram bot webhook behavior
- `/frontend/src/app`: app shell and route composition
- `/frontend/src/lib`: frontend env, Telegram integration, API client
- `/frontend/src/components`: reusable UI and domain components
- `/frontend/src/pages`: top-level screens
- `/frontend/src/hooks`: stateful flows such as bootstrap and provider chat loading

## Coding standards
- Use TypeScript everywhere with strict typing
- Prefer small service functions with explicit inputs and outputs
- Validate all externally sourced input
- Keep route handlers thin
- Keep provider adapters isolated and side-effect boundaries obvious
- Use descriptive names over clever abstractions
- Avoid introducing shared utility files unless two or more modules truly need them
- Document non-obvious behavior with short comments only where necessary

## Security rules
- Never trust Telegram webhook payloads without validating the configured secret token
- Never trust Mini App auth without verifying Telegram `initData`
- Never accept files without MIME and size validation
- Never expose raw upstream provider errors directly to clients
- Keep secrets in env vars only
- Disable dev auth and dev subscription overrides outside local development
- Replace the in-memory rate limiter before production scale
- Treat file storage as untrusted input; production should add malware scanning and content inspection

## How to add a new provider
1. Add the provider enum value to `backend/prisma/schema.prisma` if a new persistent key is needed.
2. Seed the provider in `backend/prisma/seed.ts`.
3. Create a new adapter in `backend/src/modules/providers`.
4. Register it in `backend/src/modules/providers/provider-registry.ts`.
5. Ensure the adapter conforms to `AiProviderAdapter`.
6. If the provider needs special prompt or file handling, add that logic in the adapter, not in chat routes.
7. Expose any provider-specific catalog metadata through the `Provider` table and existing catalog API.

## How to add routes
1. Create or extend a route module under `backend/src/modules/<domain>`.
2. Put input validation at the route boundary with `zod`.
3. Keep request orchestration in a service module, not inline in the route handler.
4. Mount the route from `backend/src/app.ts`.
5. Reuse auth middleware and error conventions instead of creating one-off patterns.

## How to evolve Prisma safely
- Change the schema intentionally and keep naming stable
- Generate and run a migration for every schema change
- Seed catalog-like data through `seed.ts` instead of ad hoc SQL
- Avoid destructive schema changes without a migration plan for existing data
- Prefer additive migrations for MVP evolution
- If a column is being replaced, support a transition period in application code first

## Frontend component guidelines
- Keep the Mini App mobile-first
- Prefer focused, presentational components and keep API state in hooks or top-level screens
- Route transitions should remain simple; avoid heavy global state until it is justified
- Reuse UI primitives in `frontend/src/components/ui` for buttons, cards, badges, and inputs
- Keep Telegram-specific browser behavior centralized in `frontend/src/lib/telegram.ts`
- Keep API transport logic centralized in `frontend/src/lib/api.ts`
- Reflect subscription gating clearly in the UI instead of hiding blocked actions silently

## Anti-patterns to avoid
- Do not mix provider HTTP calls into route handlers
- Do not make frontend components call `fetch` directly when the API client already covers the flow
- Do not hardcode secrets, bot tokens, or provider keys in source code
- Do not rely on local disk storage as a production architecture
- Do not add microservices for MVP concerns that fit inside the modular monolith
- Do not bypass validation because a client is “internal”
- Do not collapse all backend logic into `app.ts`
