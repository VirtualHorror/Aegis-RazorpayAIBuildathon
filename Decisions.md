# Decisions — architecture and library choices, with rationale

> One entry per meaningful decision. Newest at the bottom. Format: **ID · Date · Decision** — Context → Options → Choice → Consequences.
> Codex: add an entry whenever you add a dependency, change a pattern, or deviate from the checklist.

| ID | Date | Decision | Status |
|---|---|---|---|
| D-001 | 2026-09-05 | TypeScript end-to-end monorepo (pnpm workspaces) | accepted |
| D-002 | 2026-09-05 | Fastify 5 for the API | accepted |
| D-003 | 2026-09-05 | Next.js 16 App Router + Tailwind 4 for the dashboard | accepted |
| D-004 | 2026-09-05 | PostgreSQL 16 (apt, local) over SQLite | accepted |
| D-005 | 2026-09-05 | `pg` + hand-written SQL migrations, no ORM | accepted |
| D-006 | 2026-09-05 | Transactional outbox + in-process worker (`FOR UPDATE SKIP LOCKED`), no Redis/queue service | accepted |
| D-007 | 2026-09-05 | Provider-agnostic `LlmClient` with `anthropic`, `openai`, `stub` adapters | accepted |
| D-008 | 2026-09-05 | All LLM output is JSON validated by zod and cross-checked by rules | accepted |
| D-009 | 2026-09-05 | Money as integer paise (`bigint`) | accepted |
| D-010 | 2026-09-05 | Text-to-SQL runs under a read-only role after AST validation | accepted |
| D-011 | 2026-09-05 | Server-Sent Events for live updates (not WebSockets) | accepted |
| D-012 | 2026-09-05 | WhatsApp, x402 facilitator and Razorpay API are simulated; webhook ingress is real | accepted |
| D-013 | 2026-09-05 | API runs with `tsx` (no build step) | accepted |
| D-014 | 2026-09-05 | Node 24 LTS via nvm; pnpm 11 | accepted |
| D-015 | 2026-09-05 | Pin TypeScript 5.9.x, not 7.x | accepted |
| D-016 | 2026-09-05 | zod 4 as the single validation library (shared package) | accepted |
| D-017 | 2026-09-05 | Vitest 5 for unit + integration tests | accepted |
| D-018 | 2026-09-05 | vgpu (WebGPU) for the prism hero with a mandatory Canvas 2D fallback | accepted |
| D-019 | 2026-09-05 | Halftone "vanishing pattern" implemented in Canvas 2D, not GPU | accepted |
| D-020 | 2026-09-05 | `next-themes` for theme switching | accepted |
| D-021 | 2026-09-05 | `Bug/Feature.md` is stored as `Bug-Feature.md` | accepted |
| D-022 | 2026-09-05 | Git from day one, trunk-based, one commit per task, tag per task | accepted |
| D-023 | 2026-09-05 | Guardrail bounds live in `guardrail_config` (DB), seeded with defaults, editable from the dashboard with audit | accepted |
| D-024 | 2026-09-05 | x402 simulation uses v1 wire shape with server-issued nonces | accepted |
| D-025 | 2026-09-05 | Idempotency key = `x-razorpay-event-id`, fallback sha256(raw body) | accepted |
| D-026 | 2026-09-05 | Default LLM models: OpenAI-compatible proxy `gpt-5.6` (fast tier `gpt-5.4-mini`); Anthropic `claude-opus-5` | accepted |
| D-027 | 2026-09-05 | Deterministic pre-classification before any diagnosis LLM call | accepted |
| D-028 | 2026-09-05 | sudo-requiring setup is isolated in `scripts/bootstrap-system.sh`; everything else is user-level | accepted |

---

### D-001 · TypeScript end-to-end monorepo
**Context.** The frontend requirements (vgpu, Next.js) force Node. The user's brief lists Node.js and Python as candidates. Codex will implement most tasks; every language boundary is a place for drift.
**Options.** (a) Python FastAPI backend + Next.js frontend; (b) TypeScript everywhere; (c) Go backend.
**Choice.** (b). One toolchain, one test runner, shared zod schemas between API and UI, and TypeScript interfaces/abstract classes map directly onto the required `ActionModule` interface.
**Consequences.** No Python runtime needed at all (Ubuntu's python3 stays for apt tooling). `packages/shared` must remain dependency-light so both apps can consume it.

### D-002 · Fastify 5
**Context.** Webhook ingress needs raw-body access for HMAC verification, schema validation, structured logging and rate limiting.
**Options.** Express, Fastify, Hono, NestJS.
**Choice.** Fastify: first-class raw body via a content-type parser, pino logging built in, mature plugin ecosystem (`@fastify/rate-limit`, `@fastify/cors`), fast, and well known to Codex.
**Consequences.** Route handlers must use Fastify's `reply` API consistently; tests use `app.inject()` so the ingress can be tested without a port.

### D-003 · Next.js 16 App Router + Tailwind 4
**Context.** The dashboard must look exceptional, be responsive, support theme toggling and host WebGPU effects.
**Choice.** Next.js 16 (current major, Turbopack default) with Tailwind 4 tokens; `next-themes` for theming (D-020). Server Components for read pages; client components for SSE, charts and GPU canvases.
**Consequences.** `NEXT_PUBLIC_API_URL` is the only coupling to the API. The web app never talks to PostgreSQL directly.

### D-004 · PostgreSQL 16 over SQLite
**Context.** The core engine must demonstrate idempotency and race handling under concurrent webhook delivery. Text-to-SQL must run AI-generated SQL safely.
**Options.** SQLite (zero-ops, single writer) vs PostgreSQL (real concurrency, roles, `SKIP LOCKED`, `ON CONFLICT`).
**Choice.** PostgreSQL 16 from Ubuntu 24.04's apt repository. Two DBs (`aegis`, `aegis_test`), two roles (`aegis`, `aegis_readonly`).
**Consequences.** Setup needs one `sudo` step (D-028). Concurrency demos are real (`FOR UPDATE SKIP LOCKED`, row locks). The read-only role gives the Text-to-SQL feature a genuine security boundary instead of string filtering.
**Rollback path.** If system Postgres cannot be installed, `embedded-postgres` (npm, runs PG as the current user) is the documented alternative in `Rollback.md`; the SQL stays identical.

### D-005 · `pg` + plain SQL migrations
**Context.** ORMs hide the exact SQL that makes idempotency and locking work — the very thing evaluators need to read.
**Choice.** `pg` (pure JS, no native build) with typed repository functions and numbered `.sql` migrations (`db/migrations/NNNN_name.sql` + `.down.sql`), applied by a small runner in `apps/api/src/db/migrate.ts` that records versions in `schema_migrations`.
**Consequences.** Query results are typed by hand (`interface PaymentRow`). Slightly more boilerplate, fully transparent SQL.

### D-006 · Transactional outbox + in-process worker
**Context.** Webhooks must be acked fast and processed reliably; no external queue is allowed (local-only).
**Choice.** `jobs` table written in the same transaction as `webhook_events`; N worker loops in the API process poll with `FOR UPDATE SKIP LOCKED`; exponential backoff; dead-letter after `max_attempts`; a sweeper re-queues stale `running` jobs.
**Consequences.** One process to run. Horizontal scaling would just mean more processes polling the same table.

### D-007 · Provider-agnostic `LlmClient` (`anthropic`, `openai`, `stub`)
**Context.** This machine has `OPENAI_API_KEY` + `OPENAI_API_BASE` (an OpenAI-compatible proxy) and no `ANTHROPIC_API_KEY`. Evaluators may have either. The demo must run with neither.
**Choice.** One interface (`completeJson<T>`), three adapters, selected by `AEGIS_LLM_PROVIDER=auto|anthropic|openai|stub` (auto = anthropic if key, else openai if key, else stub). A `ResilientLlmClient` wrapper adds timeout (20 s), one retry on 429/5xx, a circuit breaker (opens after 3 consecutive failures for 60 s) and throws `LlmUnavailableError` so call sites degrade deterministically.
**Consequences.** Official SDKs only (`@anthropic-ai/sdk`, `openai`); no OpenAI-compatible shim for Anthropic. The stub returns deterministic fixtures keyed by purpose + input features, so tests and the keyless demo are reproducible.

### D-008 · JSON-only LLM outputs, zod-validated, rule-cross-checked
**Context.** Free-text LLM output cannot be audited or bounded.
**Choice.** Anthropic adapter uses `client.messages.parse` + `zodOutputFormat`; OpenAI adapter requests JSON and parses; both validate with the same zod schema; invalid → one retry → `LlmUnavailableError`. Diagnosis and compliance results pass through deterministic cross-checks that can override the LLM (recorded in `output.cross_check`).

### D-009 · Integer paise
**Choice.** `bigint` columns, `number` in TS guarded by `assertSafePaise` (< 2^53). Formatting (₹1,499.00) happens only in the UI.

### D-010 · Text-to-SQL sandbox
**Choice.** LLM sees a curated schema description without PII columns; generated SQL is parsed with `pgsql-ast-parser`, must be one `SELECT`, no denylisted functions/schemas, wrapped in `SELECT * FROM (…) q LIMIT 200`, executed on the `aegis_readonly` pool with `SET LOCAL statement_timeout = '5000ms'`. The SQL is always shown to the user.

### D-011 · SSE
**Choice.** `GET /api/v1/stream` streams `event: <type>\ndata: <json>` from an in-process `EventBus`. Simpler than WebSockets, works through proxies, auto-reconnects in browsers. The bus is not storage (C-C6).

### D-012 · What is simulated
**Choice.** Razorpay webhooks are generated by `scripts/simulate.ts` in Razorpay's documented shape and signed with the real HMAC scheme, so the ingress is production code. WhatsApp sends are persisted in `outbound_messages` in Meta Cloud API template shape and shown in the log. x402 settlement is a local facilitator. All simulated outputs are labelled.

### D-013 · `tsx` runtime for the API
**Choice.** `tsx src/server.ts` in dev and demo; no bundling step to break. `tsc --noEmit` enforces types in CI/typecheck. Revisit if startup time matters.

### D-014 · Node 24 LTS + pnpm 11
**Context.** Current LTS line at setup time is v24.20.0 ("Krypton"); vitest 5 requires Node ≥ 22.12. `.nvmrc` = `24`. pnpm 11.25.0 installed with `npm i -g pnpm` (corepack is deprecated). `packageManager` pinned in root `package.json`.

### D-015 · TypeScript 5.9.x
**Context.** npm `latest` is TypeScript 7.0.2 (the native compiler). Tooling (Next 16 templates, vitest 5, eslint plugins) and Codex's training are known-good on 5.x.
**Choice.** Pin `typescript@~5.9.3` in every package. Revisit only if a dependency requires 6+/7+.

### D-016 · zod 4
**Choice.** Single validation library for env, webhook payloads, LLM outputs, API bodies. Lives in `packages/shared` as a peer so the API and web use one copy.

### D-017 · Vitest 5
**Choice.** Unit tests co-located (`*.test.ts`); integration tests in `apps/api/test/` against `DATABASE_URL_TEST`, each test file truncating the tables it uses.

### D-018 · vgpu prism hero with Canvas 2D fallback
**Context.** The reference video is vgpu.sh's own hero (a glass prism; a white beam whose angle follows the pointer refracts into a rainbow fan). This VM's Chrome may lack WebGPU.
**Choice.** Implement the effect with `vgpu` (`effect()` fullscreen WGSL shader) behind `navigator.gpu` detection; the same geometry (`prismGeometry.ts`, pure TS, unit-tested) drives a Canvas 2D fallback with identical choreography. `vgpu` is added only in the frontend flourish task (T22) because it pulls heavy optional deps.

### D-019 · Halftone field in Canvas 2D
**Choice.** The Warp-style dot grid that brightens into solid shapes is a per-cell radius map driven by an animated smooth field — cheap on a 2D canvas, deterministic, and GPU-independent. Respects `prefers-reduced-motion`.

### D-020 · `next-themes`
**Choice.** Class strategy (`.dark` on `<html>`), `defaultTheme="system"`, `enableSystem`, toggle persists to `localStorage`; avoids flash of wrong theme.

### D-021 · `Bug-Feature.md`
**Context.** The brief names the file `Bug/Feature.md`; `/` is a path separator. The file is `Bug-Feature.md` at the repo root.

### D-022 · Git workflow
**Choice.** `git init` on day one; `main` only; one commit per checklist task (`feat(t03): …`); lightweight tag `task-03-done` after verification. Enables `Rollback.md`'s "revert the task" path.

### D-023 · Guardrails in the database
**Choice.** `guardrail_config` (key → jsonb) seeded with the defaults in `Architecture.md §6`; loaded once per job as a snapshot; editable from `/settings` with an `audit_log` row. Modules never read env vars for bounds.

### D-024 · x402 simulation shape
**Choice.** Follow the x402 v1 wire shape (`402` + `accepts[]`, `X-PAYMENT` request header, `X-PAYMENT-RESPONSE` response header) with `network: "aegis-sim"`, `asset: "INR"`, amounts in paise, and **server-issued nonces** (real x402 uses payer-side EIP-3009 nonces; server nonces make replay protection trivially provable here). Documented as a simulation in the 402 body.

### D-025 · Idempotency key source
**Choice.** Razorpay sends `x-razorpay-event-id`; use it. If absent (hand-crafted requests), fall back to `sha256(raw body)`. Either way the key is stored in `webhook_events.event_id` (UNIQUE).

### D-026 · Default models
**Context.** The proxy at `OPENAI_API_BASE` lists `gpt-5.6`, `gpt-5.4-mini`, etc. Anthropic guidance defaults to `claude-opus-5`.
**Choice.** `OPENAI_MODEL=gpt-5.6`, `OPENAI_MODEL_FAST=gpt-5.4-mini` (compliance bulk scanning, summaries); `ANTHROPIC_MODEL=claude-opus-5`, `ANTHROPIC_MODEL_FAST=claude-opus-5` (user may lower to `claude-haiku-4-5`). All env-configurable; the `tier` field on `LlmJsonRequest` selects the slot.

### D-027 · Deterministic hints before diagnosis
**Choice.** `hints.ts` derives `is_international`, `error_step`, `error_reason`, `method`, `amount_band`, `customer_locale` from the payload. The LLM receives the hints and the masked payload, must choose from enums, and its choice is cross-checked (e.g. `error_step=payment_authentication` cannot become `INSUFFICIENT_FUNDS`). This is the "right tool in the right place" story for the video.

### D-028 · sudo isolation
**Context.** `sudo` on this VM requires a password, so the agent cannot run apt non-interactively.
**Choice.** All privileged steps (apt packages, PostgreSQL install, role/DB creation) live in `scripts/bootstrap-system.sh`, run once by the human. Everything else (`nvm`, `pnpm install`, migrations, seeds, tests) is user-level and agent-runnable.
