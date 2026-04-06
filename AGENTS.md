# AGENTS.md

## Project goals
- Build a secure, production-oriented Telegram bot + Telegram Mini App that aggregates multiple AI providers behind one subscription
- Keep the codebase practical, modular, and easy to extend without splitting into microservices too early
- Preserve a clear separation between frontend, API, orchestration, provider adapters, and infrastructure concerns
- Optimize for local developer onboarding while keeping architecture aligned with real production requirements
- Support both interactive AI flows (chat, image) and async AI flows (video, music, long-running jobs)

## Core product principles
- The system is an AI aggregation platform, not a thin wrapper around one provider
- All upstream providers must be accessed through a unified orchestration layer
- Provider-specific transport, auth, payload shapes, and error mapping must stay isolated behind adapters
- Interactive requests and long-running generation jobs must use different execution paths
- Production safety, observability, and operational clarity are first-class concerns, not future nice-to-haves

## Architecture rules
- Keep `/frontend` and `/backend` separated at the package boundary
- Treat the backend as a modular monolith: domains live in `backend/src/modules/<domain>`
- Keep provider-specific logic behind the provider adapter layer in `backend/src/modules/providers`
- Do not call provider APIs directly from routes or controllers; routes delegate to services
- Introduce a provider orchestration layer that decides provider routing, fallback behavior, retries, and execution mode
- Separate interactive AI execution from async job execution
- Keep storage behind an adapter so local disk can be replaced by object storage
- Put Telegram-specific webhook and bootstrap logic in `backend/src/modules/telegram` and `backend/src/modules/auth`
- Avoid leaking frontend concerns into Prisma models or backend transport DTOs
- Avoid coupling persistence models directly to upstream provider payload formats
- Design every module so it can evolve independently inside the monolith

## Required backend module boundaries
- `auth`: Telegram Mini App bootstrap, session issuance, auth guards
- `telegram`: bot webhook handling and bot-facing actions
- `catalog`: provider catalog and model metadata exposure
- `chats`: chat lifecycle, persisted messages, summaries, orchestration entrypoint
- `providers`: provider contracts, adapters, registry, request/response normalization
- `orchestration`: provider routing, fallback policy, retry policy, streaming mode selection, async dispatch
- `jobs`: long-running job lifecycle for video, music, and other async tasks
- `files`: upload validation, storage adapters, future scanning hooks
- `subscriptions`: plan state, entitlements, usage gating, future billing seam
- `usage`: metering, quotas, request accounting, per-provider usage tracking
- `users`: authenticated current-user endpoints
- `observability`: request logs, tracing metadata, provider latency/error metrics, currently implemented through shared lib + middleware primitives

## Folder responsibilities
- `/backend/prisma`: schema, migrations, seeds
- `/backend/src/app.ts`: app composition and route mounting only
- `/backend/src/env.ts`: env parsing and runtime config policy
- `/backend/src/lib`: shared backend primitives such as auth, error mapping, logging, request correlation, Prisma, ids, clock, and retry helpers
- `/backend/src/middleware`: request-scoped cross-cutting concerns
- `/backend/src/modules/auth`: Telegram Mini App bootstrap and session issuance
- `/backend/src/modules/catalog`: provider and model catalog read API
- `/backend/src/modules/chats`: chat lifecycle, persistence, message flow
- `/backend/src/modules/files`: upload validation and storage adapters
- `/backend/src/modules/jobs`: async job creation, polling, status updates, callback handling
- `/backend/src/modules/orchestration`: provider selection, fallback, retry, timeout policy, execution path
- `/backend/src/modules/providers`: provider abstraction, vendor adapter files, registry, capability metadata, and upstream error mapping
- `/backend/src/modules/subscriptions`: subscription state, gating, future billing adapter seam
- `/backend/src/modules/telegram`: Telegram bot webhook behavior
- `/backend/src/modules/usage`: metering, quotas, and provider usage records
- `/backend/src/modules/users`: authenticated current-user endpoints
- observability is currently implemented through `backend/src/lib/logger.ts`, `backend/src/lib/request-context.ts`, and middleware rather than a dedicated `/modules/observability` package
- `/frontend/src/app`: app shell and route composition
- `/frontend/src/lib`: frontend env, Telegram integration, API client
- `/frontend/src/components`: reusable UI and domain components
- `/frontend/src/pages`: top-level screens
- `/frontend/src/hooks`: stateful flows such as bootstrap, catalog loading, chat state, job polling

## Execution model rules
- Interactive text and image requests should use a low-latency execution path
- Long-running providers such as video and music must use async jobs
- Routes must not wait on long-running upstream generations when a job-based UX is more appropriate
- Provider adapters must expose their execution mode explicitly: `interactive`, `streaming`, or `async-job`
- The orchestration layer decides whether a request should be streamed, awaited synchronously, or queued
- Retries must be policy-driven and only applied to retryable failures
- Fallback must be explicit and observable, never silent and invisible

## Provider design rules
- Every provider must implement a common contract, but adapters may expose capability flags
- Capability examples: `supportsText`, `supportsImage`, `supportsStreaming`, `supportsAsyncJobs`, `supportsFiles`
- Provider adapters currently live as files under `backend/src/modules/providers`; do not create a separate `adapters/` folder unless the package becomes crowded enough to justify it
- Adapters must normalize:
  - auth
  - request payload construction
  - response extraction
  - usage extraction
  - upstream error classification
  - request id capture
- Provider adapters must not persist business data directly
- Provider adapters must not know about Telegram, route handlers, or UI concepts
- If a provider needs custom file handling or prompt shaping, keep it inside the adapter or a provider-specific mapper
- New providers must be added without modifying chat route logic

## Coding standards
- Use TypeScript everywhere with strict typing
- Prefer small service functions with explicit inputs and outputs
- Validate all externally sourced input
- Keep route handlers thin
- Keep side-effect boundaries obvious
- Use descriptive names over clever abstractions
- Prefer explicit interfaces and data contracts over hidden conventions
- Avoid introducing shared utility files unless two or more modules truly need them
- Document non-obvious behavior with short comments only where necessary
- Prefer composition over inheritance
- Avoid framework magic when simple functions are sufficient

## Reliability rules
- Every upstream provider request must have:
  - timeout
  - retry policy
  - error classification
  - structured logging
  - latency measurement
- Treat 429, timeout, and 5xx as different failure classes
- Never collapse all upstream failures into one generic provider error
- Add idempotency where duplicate user actions are possible
- Use job records for long-running work so retries do not create invisible duplicate generations
- Persist enough provider metadata to debug incidents without exposing secrets
- Design for partial failure: one provider failing must not take down the whole app

## Observability rules
- Every inbound request should have a request id / correlation id
- Use the request context helpers so logs automatically inherit correlation metadata
- Every provider call should log:
  - provider
  - model
  - operation type
  - latency
  - status
  - retry count
  - upstream request id if available
- Prefer structured JSON logs over ad hoc strings
- Record usage data separately from application logs
- Make provider fallback decisions visible in logs and metrics
- Avoid logging user prompts in plain text unless explicitly required and properly protected
- Never log secrets, tokens, or raw credentials

## Security rules
- Never trust Telegram webhook payloads without validating the configured secret token
- Never trust Mini App auth without verifying Telegram `initData`
- Never accept files without MIME and size validation
- Never expose raw upstream provider errors directly to clients
- Keep secrets in env vars only
- Disable dev auth and dev subscription overrides outside local development
- Replace the in-memory rate limiter before production scale
- Treat file storage as untrusted input; production should add malware scanning and content inspection
- Validate webhook/callback signatures for any provider that supports callbacks
- Sanitize and bound all user-controlled metadata
- Apply authorization checks on chat, file, and job access
- Assume uploaded files and provider callbacks are hostile until validated

## Performance and scale rules
- Optimize for thousands of users over time, not necessarily thousands concurrently
- Scale backend replicas horizontally; do not invent fake “provider instances”
- Use connection pooling, queues, and distributed rate limiting where appropriate
- Do not attempt to bypass provider limits by multiplying API keys unless explicitly supported and policy-compliant
- Separate burst handling from sustained throughput planning
- Prefer queue-based backpressure over unbounded parallelism
- Streaming should be used for interactive UX where supported
- Async jobs should be used for slow providers such as video and music

## Data model evolution rules
- Keep chat history persistence decoupled from provider-native message formats
- Support message summaries and compact context evolution later
- Store provider usage and job status as first-class data
- Keep room for:
  - message attachments
  - async generation assets
  - provider request metadata
  - billing entitlements
  - usage quotas
- Avoid schema choices that lock the product into one provider’s API shape

## How to add a new provider
1. Add provider metadata to the persistent catalog only if the product needs it.
2. Seed the provider in `backend/prisma/seed.ts`.
3. Create a new adapter file in `backend/src/modules/providers`.
4. Register it in `backend/src/modules/providers/provider-registry.ts`.
5. Ensure the adapter conforms to the provider contract and exposes capability flags.
6. Add provider-specific request mappers or file handling inside the provider module only.
7. Add orchestration rules for when this provider is primary, fallback, or async-job only.
8. Add usage extraction and upstream error mapping.
9. Add tests for success, retryable failure, non-retryable failure, and empty response behavior.
10. Expose catalog metadata through the existing catalog API instead of special-casing frontend logic.

## How to add routes
1. Create or extend a route module under `backend/src/modules/<domain>`.
2. Put input validation at the route boundary with `zod`.
3. Keep orchestration in a service module, not inline in the route handler.
4. Mount the route from `backend/src/app.ts`.
5. Reuse auth middleware, request id middleware, structured logging, and shared error conventions instead of creating one-off patterns.
6. If the route triggers a long-running action, route it through the jobs module instead of blocking the request.

## How to evolve Prisma safely
- Change the schema intentionally and keep naming stable
- Generate and run a migration for every schema change
- Seed catalog-like data through `seed.ts` instead of ad hoc SQL
- Avoid destructive schema changes without a migration plan for existing data
- Prefer additive migrations for MVP evolution
- If a column is being replaced, support a transition period in application code first
- Keep provider request metadata and job state evolvable without large rewrites

## Frontend component guidelines
- Keep the Mini App mobile-first
- Prefer focused, presentational components and keep API state in hooks or top-level screens
- Route transitions should remain simple; avoid heavy global state until it is justified
- Reuse UI primitives in `frontend/src/components/ui`
- Keep Telegram-specific browser behavior centralized in `frontend/src/lib/telegram.ts`
- Keep API transport logic centralized in `frontend/src/lib/api.ts`
- Reflect subscription gating clearly in the UI instead of hiding blocked actions silently
- Distinguish clearly in the UI between:
  - interactive chat responses
  - pending async jobs
  - failed generations
  - finished downloadable assets
- Never let frontend code know provider secret details or provider-specific auth formats

## Testing expectations
- Add unit tests for provider adapters and orchestration policies
- Add integration tests for auth bootstrap, chat flow, and provider execution paths
- Add tests for retry/fallback/error mapping behavior
- Add tests for async job lifecycle and callback processing
- Add tests for authorization boundaries on chats, files, and jobs
- Add tests for usage persistence and structured provider logging where the logic is non-trivial
- Prefer deterministic tests with mocked provider responses

## Anti-patterns to avoid
- Do not mix provider HTTP calls into route handlers
- Do not make frontend components call `fetch` directly when the API client already covers the flow
- Do not hardcode secrets, bot tokens, or provider keys in source code
- Do not rely on local disk storage as a production architecture
- Do not add microservices for MVP concerns that fit inside the modular monolith
- Do not bypass validation because a client is “internal”
- Do not collapse all backend logic into `app.ts`
- Do not model long-running video/music flows as plain synchronous chat responses
- Do not couple the product to one provider API shape
- Do not hide fallback and retry behavior in undocumented utility code
