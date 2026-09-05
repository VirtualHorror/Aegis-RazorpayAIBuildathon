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
| D-029 | 2026-09-05 | Migration CLI accepts `--status` as an alias after the root `db:migrate` script's fixed `up` command | accepted |
| D-030 | 2026-09-05 | `db/seed` is typechecked and linted through `@aegis/api`; `pg`, `dotenv`, `@types/pg` are also declared as root devDependencies so files under `db/` resolve them | accepted |
| D-031 | 2026-09-05 | Unverified webhook deliveries key into `unverified:<sha256(raw body)>`, never into the claimed `event_id` | accepted |
| D-032 | 2026-09-05 | Additive projection guard migration (`0003_projection_guards`) adds `last_event_at` to orders/payments/invoices/disputes and `version` to disputes | accepted |
| D-033 | 2026-09-05 | Initialize `invoices.floor_amount_paise` from `amount_paise` on INSERT and never overwrite it during projection updates | accepted |
| D-034 | 2026-09-05 | Re-check persisted `signature_valid` inside the `process_event` transaction before parsing or projecting | accepted |
| D-035 | 2026-09-05 | Projections take rows in one global lock order (entity row, then toward the FK root) so no two projections can deadlock | accepted |

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

### D-029 · migration status shorthand
**Context.** The public checklist documents `pnpm db:migrate -- --status`, while the package script invokes the migration runner with `up` before forwarding arguments.
**Choice.** Treat a trailing `--status` (including pnpm's forwarded `--` marker) as the explicit status operation and leave `up`, `down`, and `status` commands available.
**Consequence.** The documented command reports applied, pending, and drifted migrations without requiring a second root script name.

### D-030 · `db/seed` inside the typecheck/lint programs
**Context.** `db/seed/seed.ts` and its fixtures live outside every workspace package. `pnpm typecheck` and `pnpm lint` never saw them, and `tsc` could not resolve `pg`/`dotenv` from `db/` at all (`TS2307`); the seed only ran because `tsx` falls back to resolving bare specifiers from its own install location. Found by the Verification Agent in T2 (B-003).
**Options.** (a) a new `@aegis/db` workspace package; (b) move the seed into `apps/api/src`; (c) declare `pg`, `dotenv`, `@types/pg` as root devDependencies (same `~` ranges as `apps/api`, no new package versions) and include `../../db/seed` in the `@aegis/api` typecheck and lint scripts.
**Choice.** (c). Smallest change that keeps the `Architecture.md §3` layout, makes C-E2 enforceable for the seed, and relies on ordinary Node resolution instead of a loader quirk. The lockfile only gains root importer entries.
**Consequence.** Any future TypeScript under `db/` or `scripts/` follows the same rule (AGENTS.md); if `scripts/simulate.ts` (T5) needs a dependency, declare it at the root the same way rather than importing it through a sibling package.

### D-031 · Unverified deliveries key into their own namespace
**Context.** D-025 stores the idempotency key in `webhook_events.event_id` (UNIQUE) and sources it from `x-razorpay-event-id`. T3 applied that to *rejected* deliveries too, so an unauthenticated caller could POST a forged signature naming `evt_X`, take the row first, and make Razorpay's genuine `evt_X` land on `ON CONFLICT` — answered `200 {"status":"duplicate"}` with no job. A 200 stops Razorpay retrying, so the real event was lost. Found by the Verification Agent in T3 (B-004).
**Options.** (a) do not persist rejected deliveries at all (loses the audit trail checklist step 3.3 asks for); (b) let a verified delivery promote an existing `signature_valid=false` row (re-opens the race and muddies `duplicate_count`); (c) key rejected deliveries into a separate `unverified:<sha256(raw body)>` namespace.
**Choice.** (c). `x-razorpay-event-id` is attacker-controlled until the HMAC passes, so it is never used as a key before verification; the unverified key is derived only from bytes we hashed ourselves. The audit row still exists with `status='ignored'`, `signature_valid=false`, `last_error='invalid_signature'`, and the claimed id is logged.
**Consequence.** Extends D-025: the verified key space (`evt_…` / `sha256:…`) is writable only by holders of `RAZORPAY_WEBHOOK_SECRET`. Repeated forgeries with the same body collapse onto one row and inflate its `duplicate_count`; distinct bodies add rows, bounded by the route's 300/min limit. `C-C1` now states the invariant explicitly. T5's simulator and any future ingress must keep the two namespaces separate.

### D-032 · Uniform projection event guards
**Context.** Task 4 applies the same event-time precedence guard to orders, payments, subscriptions, invoices, and disputes, but the core migration only had `last_event_at` on subscriptions and no `version` or event timestamp on disputes.
**Choice.** Add `0003_projection_guards.sql` with nullable `last_event_at` columns on orders/payments/invoices/disputes and `disputes.version integer NOT NULL DEFAULT 1`. The down migration removes only these columns.
**Consequences.** `rzp_created_at` remains the entity's own provider creation time; `last_event_at` records the event timestamp used for precedence. Existing rows remain valid because the timestamp is nullable and versions start at one.

### D-033 · Fail-closed invoice floors
**Context.** Razorpay invoice events provide an amount but no negotiation floor, while `floor_amount_paise` is non-null and later negotiation must own the bound.
**Choice.** Set the floor equal to the projected amount only for a new invoice. Projection updates never assign the floor column.
**Consequences.** A new invoice cannot be discounted until the negotiator deliberately computes a lower bound; seeded or negotiated floors survive later provider updates.

### D-034 · Worker signature defense in depth
**Context.** Ingress normally enqueues only verified events, but a queued row can be manually inserted or survive an earlier defect. Queue membership alone must not authorize projection.
**Choice.** `processEventHandler` locks and re-reads the webhook row, checks `signature_valid === true`, and returns without parsing or projecting invalid rows. The worker marks that inert job `succeeded`; the event remains `ignored` for audit.
**Consequences.** A forged or corrupted queue row cannot mutate entity tables, even if it names a known event. The check is inside the same transaction as projection and event status updates.

### D-035 · One global lock order for projections
**Context.** Task 4 verification found a real ABBA deadlock (B-006). `projectOrder` locked `orders` and then upserted `customers`; `projectPayment` upserted `customers` and then locked `orders`. Two workers handling `order.paid` and `payment.captured` for the same order and customer — a pair Razorpay delivers together — could each hold the row the other wanted, and PostgreSQL aborted one with `40P01`.
**Options.** (a) leave it: the aborted job retries after the backoff and eventually succeeds; (b) wrap projections in a serializable transaction or a table-level lock; (c) give every projection the same lock order.
**Choice.** (c). Each projection locks its own entity row first (that row is what the precedence guard reads), then walks *toward* the foreign-key root: `disputes → payments → orders → customers`, with `subscriptions` and `invoices` directly above `customers`. `projectPayment` therefore takes the `orders` row before upserting `customers`; because `orders.customer_id` is itself a foreign key, the *creation* of a missing order still happens after the customer upsert (`lockOrder` / `createOrder` in `apps/api/src/orchestrator/projections/payments.ts`).
**Consequences.** No pair of projections can form a lock cycle, so throughput does not depend on the retry path masking deadlocks. (a) was rejected because a deadlock costs a full backoff interval per collision, is invisible in the job's final state, and grows with `WORKER_CONCURRENCY`; (b) was rejected because it serialises unrelated entities. `C-C3` now states the order, so T8's orchestrator and the T10/T11 modules must extend it rather than invent their own.
