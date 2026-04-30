# Architecture Audit Report

Date: 2026-04-30

Scope: React/TypeScript frontend, Hono/TypeScript backend, Prisma/Supabase Postgres data model, Supabase-compatible storage, AI provider adapters, AI gateway, Telegram Mini App auth, file/job/chat flows, env handling, logging, retry/fallback behavior.

## 1. Executive Summary

Overall architecture score: 7/10.

The codebase is a credible modular monolith for an MVP moving toward production. The domain split is mostly clean, routes are generally thin, provider-specific logic is isolated behind adapters, and async image/video flows are modeled as jobs rather than blocking UI flows. The largest production risks are not architectural direction; they are operational hardening gaps: in-memory rate limiting and job execution, permissive production env defaults, local fallback provider execution when the gateway is absent, and storage/download behavior that can become expensive or leaky under load.

Top 5 strengths:

1. Clear module boundaries in `backend/src/modules/*`, with routes delegating to services.
2. Provider abstraction is real: `provider-types.ts`, `provider-registry.ts`, adapters, orchestration, and gateway client are separate.
3. Telegram Mini App `initData` verification is implemented with HMAC and TTL in `backend/src/lib/auth.ts`.
4. User ownership checks are consistently present for chats, files, and jobs.
5. Structured JSON logging and request context exist in both backend and gateway.

Top 5 risks:

1. In-memory rate limiter and in-memory job queue are not production-safe with multiple Cloud Run instances.
2. Backend can still call provider APIs directly if `AI_GATEWAY_URL` is absent, which violates the production egress rule.
3. Production env parsing allows placeholder secrets/tokens instead of failing fast.
4. Provider upstream error bodies are stored in logs/details and may leak sensitive prompt/provider data.
5. File and image download endpoints proxy full object bytes through the backend and keep generated image bytes in JSON payloads, creating scaling and response-size risks.

## 2. Critical Issues

### 1. In-memory rate limiting is bypassable across instances

Severity: High

Area: Security / Scaling

Affected files/routes/modules:
- `backend/src/middleware/rate-limit.ts`
- All backend routes mounted from `backend/src/app.ts`

What can go wrong:

`rateLimitMiddleware` stores buckets in a process-local `Map` keyed by `x-forwarded-for` and `authorization`. In Cloud Run with multiple instances, each instance has its own bucket. An attacker can also influence `x-forwarded-for` unless the platform/header chain is normalized before app code. This limits only accidental bursts, not abuse. Uploads, provider calls, auth bootstrap, and polling can be amplified.

How to fix:

Move rate limiting to a shared store or edge layer:
- Short term: enforce Cloud Armor / API gateway rate limits by IP and route class.
- Backend: use Redis/Upstash/Supabase-backed counters with TTL and route-specific policies.
- Do not key by raw full Authorization header; key by authenticated user ID after auth where possible and by trusted platform client IP before auth.

### 2. Job execution is still process-local and not durable

Severity: High

Area: Reliability / Scaling

Affected files/routes/modules:
- `backend/src/modules/jobs/jobs-queue.ts`
- `backend/src/modules/jobs/jobs-runner.ts`
- `backend/src/modules/jobs/jobs-service.ts`
- `backend/src/modules/chats/chat-service.ts`

What can go wrong:

Jobs are stored in Postgres, but execution is scheduled with `setImmediate` and serialized only within the current Node process. If a Cloud Run instance shuts down after returning a queued job, the task can be stranded as `QUEUED` or `RUNNING`. Multiple instances do not share provider queue state. There is an index on `GenerationJob(status, queuedAt)`, but no durable worker loop or lease/heartbeat mechanism.

How to fix:

Add a real queue or polling worker:
- Immediate: add a backend worker endpoint/process that claims `QUEUED` jobs with `FOR UPDATE SKIP LOCKED` semantics or Prisma transaction equivalent, and periodically repairs stale `RUNNING` jobs.
- Before launch: use Cloud Tasks, Pub/Sub, or a dedicated worker service. Store claim owner, heartbeat, nextAttemptAt, and max attempts.
- Keep route response fast; do not rely on request-scoped CPU.

### 3. Production can run with placeholder secrets and direct provider egress

Severity: High

Area: Security / Architecture

Affected files/routes/modules:
- `backend/src/env.ts`
- `backend/src/modules/providers/*-provider.ts`
- `backend/src/modules/providers/gateway-client.ts`

What can go wrong:

`backend/src/env.ts` defaults many sensitive values, including `JWT_SECRET`, Telegram tokens, provider API keys, and database URL. It also allows provider adapters to call upstream APIs directly when `AI_GATEWAY_URL` is absent. In production, this can accidentally deploy with weak placeholder secrets or violate the dedicated Singapore AI Gateway egress architecture.

How to fix:

Add production-only validation:
- If `APP_ENV === "production"`, reject placeholder `JWT_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `DATABASE_URL`, and provider API key defaults.
- Require `AI_GATEWAY_URL` and `AI_GATEWAY_INTERNAL_TOKEN` in production.
- Optionally reject direct provider API keys in backend production except as explicitly documented emergency fallback.

### 4. Raw upstream/provider details can leak into logs and sometimes persistence

Severity: High

Area: Security / Observability

Affected files/routes/modules:
- `backend/src/modules/providers/provider-error-mapping.ts`
- `ai-gateway/src/modules/gateway/provider-errors.ts`
- `backend/src/app.ts`
- `ai-gateway/src/app.ts`
- `backend/src/modules/chats/chat-service.ts`
- `backend/src/modules/jobs/jobs-runner.ts`

What can go wrong:

`createUpstreamHttpError` stores truncated upstream bodies in `details.upstreamBody`. Backend/gateway error handlers log `details`. Provider bodies often include prompt fragments, policy classifications, account/provider metadata, and sometimes request diagnostics. In `chat-service.ts`, provider failure messages are stored as `failureReason` and async failure metadata. Some are client-safe, but creation failures can use raw `error.message`.

How to fix:

Use two-channel error handling:
- Keep raw provider body only in a protected debug sink if explicitly enabled, not default app logs.
- Store only provider code/category/status/requestId in DB-visible fields.
- Ensure all user-visible failure messages pass through `toClientSafeProviderMessage`.
- Add log redaction for headers, tokens, prompts, upstream bodies, and provider request payloads.

### 5. File/object delivery proxies full bytes through backend

Severity: Medium / High at scale

Area: Scaling / Reliability / Cost

Affected files/routes/modules:
- `backend/src/modules/files/file-routes.ts`
- `backend/src/modules/files/file-service.ts`
- `backend/src/modules/jobs/jobs-routes.ts`
- `backend/src/modules/jobs/jobs-service.ts`
- `backend/src/modules/files/storage/supabase-storage.ts`

What can go wrong:

`/api/files/:fileId/content`, `/api/files/:fileId/public-content`, and `/api/jobs/:jobId/images/:imageIndex` download the full object/payload into backend memory and return it. Generated image jobs keep image base64 in `GenerationJob.resultPayload`; `getGenerationJob` returns the full payload. With image/video growth, this can inflate DB size, backend memory, response latency, and Cloud Run egress costs.

How to fix:

Move toward object-storage URLs:
- Store generated images as `FileAsset` objects too, not base64 JSON in Postgres.
- Return short-lived signed storage URLs or backend-signed redirect URLs.
- Keep backend authorization/token minting, but avoid byte proxying for large assets.
- Enforce response-size limits and use streaming if proxying is still needed.

## 3. Security Findings

### Auth

Strengths:
- Telegram Mini App auth verifies HMAC, `auth_date`, and user payload in `backend/src/lib/auth.ts`.
- Session tokens are HMAC-signed with expiry and verified in `backend/src/middleware/auth.ts`.
- Auth middleware protects `/api/me`, `/api/chats`, `/api/files` except signed public content, `/api/jobs` except signed image content, and `/api/subscription`.

Findings:
- Custom session token format is simple and works, but lacks `iat`, `aud`, key ID, rotation strategy, and revocation. For MVP this is acceptable; for public launch use JWT/JWS or add key rotation and session versioning.
- `verifySession` calls `JSON.parse` without catch. Invalid base64 JSON becomes a 500 via `toAppError`, not 401. Fix by catching parse errors and throwing `UNAUTHORIZED`.
- Frontend stores bearer tokens and bootstrap cache in `localStorage` in `frontend/src/lib/api.ts` and `frontend/src/hooks/use-bootstrap.ts`. Telegram Mini Apps are browser contexts; this is common but XSS-sensitive. CSP and no untrusted HTML become important.

### Authorization

Strengths:
- Chats are loaded by `{ id, userId }` in `getChatWithMessages` and `createMessage`.
- Files are loaded by `{ id, userId, status: READY }` in `getOwnedFileContent` and `createOwnedFileLinks`.
- Jobs are loaded/deleted by `{ id, userId }`.
- Chat-linked jobs verify chat ownership and message ownership in `jobs-service.ts`.

Findings:
- `createGenerationJob` accepts arbitrary `providerId`, `kind`, and `metadata` from the client. It validates provider existence and user chat ownership, but provider/kind compatibility is delegated to runtime adapter failure. Tighten at route/service boundary so unsupported combinations fail before queue creation.
- Destructive deletes are protected by ownership, but no CSRF token exists. Because auth is bearer-token based and CORS is restricted, this is lower risk. XSS would still allow destructive actions.

### File access

Strengths:
- Short-lived HMAC tokens are used for public file links and image links, with 5-minute TTL.
- Tokens include user ID and file/job ID.
- Filenames are normalized for headers and storage keys.
- Upload MIME allowlist and max size exist.

Findings:
- Upload validation trusts browser-provided MIME or extension fallback. There is no magic-byte sniffing, content scanning, or malware scanning.
- `access-control-allow-origin: https://web.telegram.org` is hardcoded for file content responses. This may not cover Telegram mobile webviews and is inconsistent with app-level CORS.
- Supabase storage uses service role server-side, which is correct, but object keys are not independently scoped by storage policies. A backend bug would have full bucket access.
- Local storage adapter has no path traversal from current code because storage keys are generated, but it should still reject `..` defensively.

### Provider APIs

Strengths:
- Provider API keys are not exposed to frontend.
- AI Gateway has internal bearer auth in `ai-gateway/src/middleware/auth.ts`.
- Gateway routes validate request bodies with zod.
- Gateway logs provider, model, region, egress mode, retry count, upstream status/request id, and latency.

Findings:
- Backend direct provider calls remain active when gateway is not configured.
- `OpenAiProviderAdapter`, `AnthropicProviderAdapter`, `GeminiProviderAdapter`, `NanoBananaProviderAdapter`, and `VeoProviderAdapter` contain direct fetch calls and API key usage. This is acceptable for local/dev but should be disallowed in production.
- Gateway auth is shared static bearer token. Rotate regularly; consider Secret Manager and per-service identity/IAM in addition to bearer auth.

### Secrets

Strengths:
- Frontend env only uses API URL/dev auth flag; provider secrets are backend/gateway only.
- Supabase service role key is validated against project ref.

Findings:
- `.env` content was visible in IDE context during this audit. Any exposed provider key should be rotated.
- Production env should fail closed on placeholders.
- `telegram/status` exposes secret length and fingerprint. Fingerprint is not the secret, but this endpoint is public and operationally noisy. Restrict or remove in production.

### Logging

Strengths:
- Structured JSON logs and request context are present.
- Provider fallback/retry decisions are logged.

Findings:
- Logs include stack traces and `details`, including upstream bodies. Gate stack traces by environment and redact details.
- Telegram webhook logs the first 32 chars of message text. This is user content. Avoid logging user message text by default.

### Rate limiting

Current limiter is process-local and route-agnostic. It is insufficient before public launch. Add distributed limits and route-specific lower thresholds for auth bootstrap, uploads, job creation, retry, and file link minting.

### Input validation

Strengths:
- Routes use zod for JSON payloads.
- Prompt/content length is bounded to 12,000 chars.
- Gateway request shapes are bounded.

Findings:
- `metadata` is arbitrary on job creation. Bound accepted keys per provider/kind.
- File upload count is limited on chat messages, but upload route itself can be hit repeatedly within broad rate limit.

## 4. Architecture Findings

### Modularity

The backend is well aligned with the modular monolith goal. `backend/src/app.ts` only mounts routes and middleware. Domain services live in `backend/src/modules/*`. Observability is in shared libs/middleware rather than a full module, matching current project instructions.

Concern: `chat-service.ts` has grown into a large orchestration surface: chat persistence, provider execution, async video job setup, retry/delete, attachment cleanup, usage persistence, and presentation assembly. This is still manageable, but should be split internally into small service files before adding more async media types.

### Provider abstraction

Strong foundation:
- `AiProviderAdapter` and `ProviderAdapterError` define a common contract.
- Provider registry centralizes adapter lookup.
- Direct provider payloads are isolated in provider adapter files or gateway modules.

Gaps:
- Capability flags are coarse. `supportsFiles` currently means "file metadata context" for chat, not binary file ingestion by providers.
- Streaming is modeled in capability but not implemented.
- Async job providers are still executed synchronously inside the backend/gateway worker process once claimed.

### Orchestration

Strengths:
- Retry/fallback is explicit in `orchestration-service.ts` and `orchestration-policy.ts`.
- Fallback decisions are logged.

Gaps:
- Retry policy is hardcoded to one retry in backend orchestration. Gateway retry policy is env-configured.
- No provider-specific concurrency/rate budget exists.
- Async fallback is mostly theoretical for media providers because Nano Banana/Veo have no fallback candidates.

### Jobs/async flows

Good:
- `GenerationJob` is first-class.
- Chat-linked Veo jobs update assistant messages.
- Job statuses and provider metadata are persisted.

Needs work:
- Durable queue/worker/lease is missing.
- Stale `RUNNING` recovery is missing.
- No idempotency key on job/message creation; double taps can create duplicate jobs.

### Storage abstraction

Good:
- `StorageAdapter` separates local and Supabase storage.
- FileAsset records are decoupled from storage implementation.

Needs work:
- Generated image payloads should move from DB JSON to FileAsset/storage.
- Signed URL abstraction should be part of storage or files module to avoid separate file/image token flows diverging.

### Frontend/backend separation

Good:
- Frontend calls centralized `apiClient`.
- Provider secrets and provider-native auth do not appear in frontend.
- Frontend has typed DTOs and domain hooks.

Concerns:
- Frontend DTOs mirror backend responses manually; no shared generated OpenAPI/contract tests.
- Bootstrap cache stores full user/providers/subscription/token in localStorage.
- UI currently knows some provider execution mode/capability behavior, which is acceptable for routing but should stay metadata-driven.

## 5. Scalability Findings

### Current bottlenecks

1. In-memory rate limiter: no cross-instance protection.
2. In-memory job queue: no durability or cross-instance coordination.
3. Provider calls for Veo can occupy a process for up to 10 minutes in direct mode.
4. File/image downloads proxy bytes through backend memory.
5. Chat history fetch without limit for non-async chats loads all messages.
6. `listChats` loads all messages for all chats and selects latest in memory; this will degrade with many chats/messages.

### Expected limits

For a private MVP, the architecture can handle low-to-moderate traffic. For sustained growth, the first limits will be provider rate limits, backend memory/CPU from file proxying, and DB query cost around chat/message listing.

### Risks with 5,000+ users

- Polling jobs every 1.5-2.5s from frontend can create many read requests.
- One busy provider can create a queue backlog in each instance, not globally.
- Postgres connection pressure can rise; Prisma with `@prisma/adapter-pg` needs a pooling plan for Supabase.
- Large JSON payloads in `GenerationJob.resultPayload` will bloat DB and backups.

### Provider rate-limit risks

- No global per-provider concurrency limiter.
- No distributed token bucket for provider requests.
- Retry can worsen rate-limit pressure if not coordinated.
- Fallback is logged but not metered as a separate decision metric beyond usage metadata.

### DB/storage risks

Schema indexes are reasonable for current access patterns:
- `GenerationJob(userId, providerId, kind, createdAt, id)` and status variants help image history.
- `Message(chatId, createdAt)` helps chat pages.
- `ProviderUsage` has useful lookup indexes.

Missing or future indexes:
- `Chat(userId, lastMessageAt)` would better match `listChats` ordering than `Chat(userId, updatedAt)`.
- If querying subscriptions by latest/current often, consider `(userId, currentPeriodEnd, createdAt)` or a single current subscription invariant.
- JSON metadata lookup for linked message deletion is not ideal. `GenerationJob` used to have or should regain an explicit `messageId` relation/index for linked messages.

Supabase-specific note: there is no evidence of database-level RLS use for app tables. Since the backend uses a server connection, app-level authorization is normal. If any direct Supabase client access is introduced from frontend later, RLS must be designed before exposing tables.

## 6. Technology Review

What is good:

- Hono + TypeScript is suitable for a small modular API.
- Prisma with Postgres/Supabase is appropriate for relational ownership, jobs, usage, and subscriptions.
- Cloud Run backend + Cloud Run AI Gateway fits the fixed-region egress requirement.
- Zod at route/gateway boundaries is a strong choice.
- React + TypeScript + Vite is current and pragmatic.

What is risky:

- Backend package scripts still reference `wrangler deploy` and `wrangler dev`, while docs/architecture target Cloud Run. This is a deployment/DX mismatch.
- React Router 7 and React 19 are modern; ensure deployment/build tooling is pinned and tested because ecosystem examples may lag.
- Prisma 6.19 is current enough; do not rush Prisma 7 until adapter and deployment behavior are verified.
- `@supabase/ssr` appears in frontend dependencies but current auth is custom Telegram JWT; unused auth dependencies add confusion.

What should be updated later:

- Add OpenAPI generation or typed shared API contracts.
- Add dependency vulnerability scanning in CI.
- Add structured metrics/traces beyond logs.
- Add a queue technology before public launch.

## 7. Recommendations Roadmap

### Immediate fixes

1. Rotate any provider keys exposed during development or in chat context.
2. Add production env fail-fast validation for placeholders and required gateway config.
3. Redact upstream bodies/details from normal logs.
4. Catch invalid session token JSON and return 401.
5. Disable or protect `/api/telegram/status` in production.
6. Add route-specific limits for upload/job/auth endpoints, even before distributed limiter is ready.

### Before public launch

1. Replace in-memory limiter with distributed/shared rate limiting.
2. Replace in-process job queue with Cloud Tasks/Pub/Sub/worker claim loop.
3. Add stale job recovery for `RUNNING` jobs.
4. Move generated images to storage/FileAsset instead of DB base64 JSON.
5. Require AI Gateway in backend production.
6. Add idempotency keys for message sends and job creation.
7. Add provider concurrency/rate budgets.
8. Add file magic-byte validation and malware scanning pipeline or quarantine state.

### After first users

1. Add dashboards for request rate, provider latency, provider error category, job duration, queue depth, and token usage.
2. Add admin tooling for failed/stuck jobs and user support.
3. Add pagination improvements for chat list and message history.
4. Add retention policies for files, generated assets, logs, and raw provider metadata.
5. Add contract tests between frontend DTOs and backend responses.

### Long-term improvements

1. Implement streaming for capable providers.
2. Add billing provider integration and webhook signature verification.
3. Add multi-provider model catalog from DB rather than mostly static registry.
4. Add advanced storage signed URLs/CDN delivery.
5. Add a policy engine for fallback/retry/cost routing per plan.

## 8. Refactoring Plan

Step 1: Production env guard.

Small change: add a `validateProductionEnv()` block in `backend/src/env.ts` and gateway env. Test with unit-level env parsing or a small script. No behavior change in development.

Step 2: Error redaction.

Small change: update provider error mapping to store/log only status/code/request ID by default. Add tests that upstream prompt-like body is not present in client JSON/log metadata.

Step 3: Durable job claiming.

Small change: add `claimQueuedGenerationJob()` and `markStaleRunningJobsQueued()` service functions. Use existing `GenerationJob(status, queuedAt)` index. Add tests around claim exclusivity and stale repair.

Step 4: Worker entrypoint.

Small change: create a backend worker process or scheduled endpoint that repeatedly claims and runs jobs. Keep current enqueue as a dev-only fallback.

Step 5: Route-level idempotency.

Small change: accept optional `idempotencyKey` on message/job creation, add DB table or unique fields scoped by user/action, return existing result on duplicate.

Step 6: Asset storage unification.

Small change: persist generated images through `persistGeneratedFile`, store lightweight result references in `resultPayload`, and reuse file link APIs.

Step 7: Chat service decomposition.

Small change: split internal helpers into `chat-read-service.ts`, `chat-message-service.ts`, and `chat-async-message-service.ts` without changing route contracts.

Step 8: Shared API contract.

Small change: introduce OpenAPI or zod DTO schemas exported from backend and consumed in API tests. Avoid changing transport until contracts are documented.

Step 9: Observability metrics.

Small change: add metric emission wrappers around existing logs for provider attempts, queue depth, job duration, usage writes, and file downloads.

## 9. Optional PDF Export

Markdown report saved as `architecture-audit-report.md`.

PDF export status: pending local tooling check. If local PDF tooling is unavailable, keep Markdown as the source of truth and export PDF from a Markdown viewer or CI documentation job.

