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
| D-046 | 2026-09-05 | Unapplied diagnosis snapshots are returned as non-persisted deterministic results | accepted |
| D-047 | 2026-09-05 | Pin the API Vitest command to `--no-file-parallelism --maxWorkers=1` for the shared PostgreSQL test database | accepted |
| D-048 | 2026-09-05 | Reserve absent order identities with a NULL-customer placeholder before customer upserts | accepted |
| D-049 | 2026-09-05 | Serialize action execution with a session advisory lock while keeping module code outside row-lock transactions | accepted |
| D-050 | 2026-09-05 | Carry development LLM chaos explicitly on `process_event` jobs and restore it in the worker | accepted |
| D-051 | 2026-09-05 | Resume approved actions after a worker crash instead of re-proposing them | accepted |
| D-052 | 2026-09-05 | Batch Tasks 10–16 into one Sprint 2 handoff (deliberate, recorded C-G1 deviation) | accepted |
| D-053 | 2026-09-05 | Declarative entity updates and proposal hooks keep module side effects outside row locks | accepted |
| D-054 | 2026-09-05 | Approval decisions lock and audit the pending action, then reuse `executeAction` for execution | accepted |
| D-055 | 2026-09-05 | Deterministic evidence packets | accepted |

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
**Choice.** (c). Each projection locks its own entity row first (that row is what the precedence guard reads), then walks *toward* the foreign-key root: `disputes → payments → orders → customers`, with `subscriptions` and `invoices` directly above `customers`. `projectPayment` and `projectOrder` call `lockOrderSlot` before upserting `customers`; an absent order is reserved by a NULL-customer placeholder, then filled after the customer upsert. This preserves the FK requirement without reopening the cold-start gap (B-007).
**Consequences.** No pair of projections can form a lock cycle, so throughput does not depend on the retry path masking deadlocks. (a) was rejected because a deadlock costs a full backoff interval per collision, is invisible in the job's final state, and grows with `WORKER_CONCURRENCY`; (b) was rejected because it serialises unrelated entities. `C-C3` now states the order, so T8's orchestrator and the T10/T11 modules must extend it rather than invent their own.

### D-036 · Canonical simulator builders and package wiring
**Context.** The CLI runs from `scripts/`, which is not a workspace package, while the development simulation route runs inside `apps/api` and must share the exact same fixtures.
**Choice.** Keep all scenario builders and the seeded ID factory in `packages/shared/src/sim/`; import them relatively from `scripts/simulate.ts` and re-export them through `scripts/sim/` compatibility paths. Wire the root `pnpm sim` command through `apps/api`'s `sim` script, and include `../../scripts` in the API typecheck and lint programs.
**Consequences.** The CLI and `POST /api/v1/sim/run` cannot drift to different payload definitions, and `tsc --noEmit --listFiles` proves the out-of-package simulator is covered (C-E2, B-003). No root package-script rewrite or duplicate implementation is needed.

### D-037 · Seeded IDs, timestamps, and duplicate delivery semantics
**Context.** A simulator run must be replayable while duplicate requests must exercise ingress idempotency rather than create new events.
**Choice.** Use a small deterministic PRNG and per-kind counters for natural-key IDs; pass `createdAt` into every builder instead of reading the clock. `--dupes N` means N additional POSTs of the identical serialized body and headers after the original. An omitted seed is generated once and printed.
**Consequences.** A pinned seed reproduces bodies and HMACs byte-for-byte, and duplicate totals map directly to `duplicate_count` without regenerating event IDs.

### D-038 · Quarantine forged simulator deliveries
**Context.** The event-id header is untrusted until HMAC verification. Reusing a real-looking `evt_` key for an invalid signature could suppress a later genuine delivery (B-004, D-031).
**Choice.** The `bad_signature` scenario sends a deliberately invalid HMAC, while ingress derives its durable key as `unverified:<sha256(raw body)>`; the simulator verifies that row and never treats it as a trusted event key.
**Consequences.** Forged deliveries remain auditable (`ignored`, `signature_valid=false`) without occupying the verified idempotency namespace.

### D-039 · Chaos flag is transport-only in T5
**Context.** The LLM client that interprets chaos modes is a later task, but the simulator flag must be accepted now.
**Choice.** `--chaos llm_down` only adds `x-aegis-chaos: llm_down` to each request. Task 5 makes no LLM calls and does not stub provider behavior.
**Consequences.** The flag is observable by future development-only consumers without introducing nondeterministic AI behavior into ingress or projection tests (C-A1, C-A2, C-D5).

### D-040 · Rate-limit responses are a first-class simulator result
**Context.** The webhook route allows 300 requests per minute. A concurrent `--burst 400` can therefore receive HTTP 429 responses.
**Choice.** Classify HTTP 429 as `rate_limited`, print it as its own total, and exclude it from accepted/rejected counts. The simulator never retries or silently relabels a throttled request.
**Consequences.** The result table reflects what the API actually accepted, and a burst run can be compared with durable event/job counts without claiming rejected work was authenticated failure.

### D-041 · Burst verification fails closed on retries
**Context.** Projection lock-order regressions can self-heal through the worker retry path and otherwise disappear from final status.
**Choice.** After a burst, query the jobs for accepted event IDs until they are terminal. Any `attempts > 1` is reported as a critical lock-order regression (including deadlock errors); success requires every accepted job to be `succeeded` with `max(attempts)=1`.
**Consequences.** Concurrency regressions remain visible in simulator evidence instead of being hidden by longer waits or worker retries (C-C3, B-006).
**Amended 2026-09-05 (Claude, T5 verification).** As written the check could not fail: `--burst N` builds N *distinct* events, so no two jobs touch the same row and `max(attempts)=1` holds under any lock order. The claim now belongs to `--contend` (D-042); a plain burst proves throughput and one-shot processing, nothing about locking.

### D-042 · A lock-order proof needs contention, not concurrency
**Context.** D-041 made `max(attempts)=1` the simulator's lock-order evidence, but `--burst N` gives every event fresh natural keys (`Checklist.md` §5: "N distinct events concurrently"). A run of 50 produced 50 payments across 50 distinct orders and 50 distinct customers — PostgreSQL had nothing to deadlock on, so the assertion was vacuous.
**Options.** (a) leave it and rely on the deterministic T4 unit test alone; (b) redefine `--burst` to contend, breaking the Checklist's definition; (c) add `--contend` as a second burst shape.
**Choice.** (c). `buildContendedBurst` (`packages/shared/src/sim/scenarios.ts`) aims every event in a burst at one order and one customer, alternating `payment.failed` and `order.paid` with strictly increasing `created_at`, which is the only shape that can form the ABBA cycle. `verifyBurst` now prints `contended=true|false` so the number is never read without knowing whether it could have failed. A shared unit test pins the fixture shape (one order, one customer, distinct payments and event ids) so the probe cannot silently go vacuous again.
**Consequences.** (a) was rejected because the T4 test pins one interleaving in one transaction pair and cannot cover the worker path end to end — and it turned out to miss the cold-start window entirely (B-007, found by `--contend` on its first run). (b) was rejected because the distinct-event burst is the throughput measurement and the Checklist pins its meaning. `--contend` exits non-zero until B-007 is fixed; that is the correct reading of the current code, not a broken tool.

### D-043 · The simulator fails closed on its own evidence
**Context.** A seeded event id that already exists in `webhook_events` comes back `duplicate`. The run still printed a clean table and exited 0, so `accepted=0 duplicate=4` read like a result rather than a collision. Observed once during T5 verification: `--seed 20260905` collided with an earlier run's generated seed (a brute-force sweep of all 2^32 seeds shows exactly two produce that event id, so the id scheme is sound — the reporting was not).
**Choice.** `verifyOriginalDeliveries` (`scripts/sim/verification.ts`) gives every scenario one terminal category — `bad_signature` → rejected, `unknown_event` → ignored, everything else → accepted — and exits non-zero when an original delivery lands anywhere else, naming the seed to change. A 429 is the one benign exception; it already has its own total (D-040). `--dupes` replays are exempt by construction, via an `original` flag set at send time.
**Consequences.** The simulator can no longer report a table it cannot vouch for. Latency percentiles also exclude rate-limited rows, which measure the limiter rather than the ingress path, and the output line says so.

### D-044 · Official SDK adapters behind one validated boundary
**Context.** Task 6 needs provider-specific request mechanics while C-A2 requires every model result to be schema-validated before it can cross into application code. This machine has an OpenAI-compatible proxy but no `ANTHROPIC_API_KEY`.
**Choice.** Add `@anthropic-ai/sdk~0.123.0` and `openai~7.10.0` to `@aegis/api`. Anthropic uses `messages.parse`/`zodOutputFormat`; OpenAI requests JSON mode, tolerates a proxy `response_format` rejection, extracts one balanced JSON object, and makes one schema-repair attempt. The stub uses deterministic fixtures and the same caller schema. All adapters sit behind the resilient timeout/retry/circuit-breaker wrapper and expose only validated JSON.
**Consequences.** Provider selection is explicit and auditable (`auto|anthropic|openai|stub`), credentials remain environment-only, and the Anthropic adapter is mock-tested locally rather than represented by fabricated live output. The development-only ingress chaos header is stored in `AsyncLocalStorage` and ignored in production.

### D-045 · The prompt registry owns the diagnosis contract; nobody restates it
**Context.** T6 landed the diagnosis enums and `DiagnoseOutputSchema` **twice** — once in `apps/api/src/llm/prompts/index.ts` and once, independently, in `apps/api/src/llm/stub-fixtures.ts` — and `stub.test.ts` validated the fixtures against the fixture-local copy. The stub exists precisely to catch schema drift (C-A2), so a stub checked against its own copy of the contract is self-consistent and blind: adding a root cause to the prompt registry would leave every stub test green while the stub started throwing `stub_invalid_fixture` at runtime, silently degrading every diagnosis to the fallback path. `Checklist.md` Task 7 then plans a *third* copy in `apps/api/src/diagnosis/schema.ts`.
**Choice.** `apps/api/src/llm/prompts/index.ts` is the single definition of `ROOT_CAUSES`, `STRATEGIES`, and `DiagnoseOutputSchema`. `stub-fixtures.ts` re-exports them under its fixture-oriented names (`STUB_ROOT_CAUSES`, `STUB_STRATEGIES`, `DIAGNOSE_OUTPUT_SCHEMA`) instead of restating them, the unused third alias `DiagnosisSchema` is gone, and `stub.test.ts` imports the registry's schema. Task 7's `diagnosis/schema.ts` must re-export from the registry too, never restate the enums.
**Consequences.** A change to the enums or bounds is a one-file change that every stub fixture is immediately validated against, so drift fails a test instead of degrading production. Import cycles are avoided because `prompts/index.ts` depends only on `client.ts` types.

### D-046 · Do not diagnose unapplied projection events
**Context.** Projection precedence marks duplicate or stale deliveries with `entity.applied = false`. Creating a new diagnosis row for one of those events would produce an audit record for state that did not win reconciliation and could trigger a later action twice.
**Choice.** The diagnostician skips the model and persistence paths for an unapplied snapshot, returning a deterministic result with `id = skipped:<event_id>`, `provider = skipped`, and an explicit `entity_not_applied` reason. Applied snapshots retain the normal LLM/cross-check/fallback flow.
**Consequences.** Duplicate and stale deliveries remain observable to their caller without spending model capacity or creating fresh diagnosis rows. Task 8 can choose whether to surface the marked result in its event timeline while preserving idempotent diagnosis storage.

### D-047 · Explicitly serialize API Vitest files
**Context.** Vitest 5 still interleaved database-owning files under the package command even with `fileParallelism=false` and worker limits in `vitest.config.ts`; migration rollback in the schema suite could remove `jobs` while worker tests were running.
**Choice.** Put `--no-file-parallelism --maxWorkers=1` directly in `apps/api/package.json`'s `test` script, retaining the config limits as defense in depth.
**Consequences.** Root `pnpm test` is deterministic for the shared `aegis_test` database at the cost of serial file startup. The three consecutive Task 7 gates use this command and all pass.

### D-048 · Reserve absent order identities before customer upserts
**Context.** `SELECT ... FOR UPDATE` does not lock a row that is absent. During a cold-start delivery, `projectPayment` could therefore upsert `customers` before its `orders` parent was reserved, while a concurrent `projectOrder` held an uncommitted order row and waited for that customer (B-007).
**Options.** (a) rely on the worker retry after PostgreSQL aborts one transaction; (b) take an advisory lock for every order id; (c) insert a NULL-customer placeholder into `orders` before either projection touches `customers`.
**Choice.** (c). `lockOrderSlot` serializes existing rows and first sightings through the same `orders` row lock. The order projection fills a placeholder in place so a first event remains version 1; the payment projection links its customer before inserting the payment FK.
**Consequences.** The C-C3 order remains entity -> order -> customer, including when the parent did not previously exist. The cold-start interleaving regression test now completes both transactions without an ABBA cycle, while unrelated order ids continue in parallel.

### D-049 · Serialize action execution without holding row locks over module code
**Context.** `executeAction` must prevent two workers from invoking a side-effecting module for the same unique action, but C-A6 forbids holding a `SELECT ... FOR UPDATE` transaction while module code could call an LLM.
**Options.** (a) rely on the unique action row and let concurrent modules race; (b) add a long-lived `executing` status/claim column and lease recovery; (c) hold a PostgreSQL session advisory lock keyed by the action id while two short row-lock transactions bracket the unlocked module call.
**Choice.** (c). `execute.ts` pins one pool client, acquires `pg_advisory_lock(hashtextextended(...))`, commits the initial approval check before `module.execute`, then locks/persists the result in a second transaction and releases the session lock. A crashed process releases the session lock when PostgreSQL closes the connection, and the existing action idempotency key remains the durable uniqueness boundary.
**Consequences.** Separate worker processes cannot invoke one action concurrently, no LLM-capable module runs inside a row-lock transaction, and no schema migration is needed. The two-pool integration regression proves the module call occurs once.

### D-050 · Carry development LLM chaos across the durable worker boundary
**Context.** `AsyncLocalStorage` only follows the ingress request context. A `process_event` job is consumed later by a worker loop, so a development `x-aegis-chaos: llm_down` header would otherwise disappear before diagnosis.
**Options.** (a) rely on request-local storage (does not cross the queue); (b) persist arbitrary header values (creates an unbounded control channel); (c) persist the single validated `llm_down` literal on the job in development/test and restore it immediately around the worker's orchestrator call.
**Choice.** (c). Ingress keeps the `NODE_ENV` gate, `reconcile` writes `{ eventId, chaos: 'llm_down' }` only for that mode, and `processEventHandler` accepts only that literal before calling `runWithLlmChaos` (B-009).
**Consequences.** Chaos drills reach worker-side LLM calls deterministically while production jobs carry no chaos field. The bounded restore happens outside the projection transaction, preserving C-A6 and preventing arbitrary job payload data from controlling the LLM client.

### D-051 · Resume approved actions after a worker crash
**Context.** A worker can commit an auto-approved action row and then exit before `executeAction`. Retrying the same `process_event` projects the duplicate as `entity.applied=false`; simply skipping that projection would leave the approved action orphaned forever.
**Choice.** On an unapplied retry, query only `actions` for the trigger event with `status='approved'` and resume them through the same advisory-locked `executeAction` path. Idempotency conflicts in an applied retry use the same lookup; blocked, pending, executed, and failed rows remain no-ops.
**Consequences.** Recovery executes persisted approved work exactly once without proposing a new action, while D-046 still prevents stale deliveries from spending an LLM call or creating a fresh action. Module code remains outside `SELECT ... FOR UPDATE` transactions.

### D-052 · Batch Tasks 10–16 into a single Sprint 2 handoff
**Context.** C-G1 requires one checklist task per handoff so a red review can be bisected to one task. The build is on a fixed hackathon deadline and T10–T16 are seven largely independent feature slices.
**Options.** (a) keep one handoff per task (seven review round-trips, safest bisect); (b) one continuous run landing all seven in one commit (fast, but one red task blocks everything); (c) one continuous run with **one commit per task**, each with its own tests, verified as a batch.
**Choice.** (c), on the project owner's explicit instruction. `HANDOFF14.md` carries all seven tasks; the implementing agent still commits each task separately using the checklist's exact commit message, so bisectability survives the batching.
**Consequences.** C-G1 is knowingly relaxed for this one sprint and recorded here rather than edited out of `Constraints.md`. Verification tags `task-10-done` … `task-16-done` per task and re-hands only the tasks that come back RED.

### D-053 · Declarative entity updates and proposal hooks (2026-09-05)

Action modules execute outside row locks, including any language-model call. Projection mutations therefore return a closed `EntityStateUpdate` list; `executeAction` locks `actions` first, then the allowlisted entity row, checks optional expectations, and applies the update atomically with action effects. The optional `onProposed` hook runs only after a new action row commits, allowing evidence packets to be persisted without making `propose` side-effecting. Synthetic dunning signals use the same proposal, guard, execution and audit path.

### D-054 · Approval decisions reuse the execution path (2026-09-05)

The approval route locks the pending action and writes the human decision/audit row in one short transaction. An approved action is then reconstructed and passed to the existing advisory-locked `executeAction` path; rejected actions never execute. This makes concurrent human clicks resolve to one winner and one `409` without introducing a second side-effect path or holding a row lock over module code.

### D-055 · Deterministic evidence packets (2026-09-05)

Chargeback evidence is assembled through ordered SQL reads and validated against a closed zod packet before the masked narrative call. The packet is inserted only after an action row commits through `onProposed`; execution checks the human review state before marking the simulated submission and dispute projection.

### D-056 · Local AST parser for Ask Aegis (2026-09-05)

Text-to-SQL is validated locally with `pgsql-ast-parser@12.0.2` before execution. The validator accepts one SELECT-only statement over the documented allowlist, rejects mutation/system-schema/denylisted-function access, and wraps valid SQL with a 200-row limit. Execution uses the separately configured readonly PostgreSQL pool with a five-second transaction-local timeout; PII columns remain unavailable by grant, so database errors are returned honestly.

### D-057 · Compliance evidence is fail-closed (2026-09-05)

The scanner always runs the deterministic keyword prescreen before the fast classification call. A missing or fabricated case-sensitive evidence span, or a keyword/model category disagreement, becomes `needs_review`; model outages and malformed payloads produce medium-risk keyword-only flags with `degraded_count` incremented. Flags are serialized by `(scan_run_id, product_id)` advisory locks so retries cannot create duplicates.

### D-058 · Buyer CLI uses the API workspace toolchain (2026-09-05)

The x402 buyer lives under `scripts/`, while its TypeScript runner is installed in `@aegis/api`. The root command delegates to that workspace's `tsx`, and the script uses an async `main` so it remains runnable from the repository root's CommonJS package boundary. It parses the nonce from the exact `accepts[].extra` challenge shape.

### D-059 · Bus event names live in `@aegis/shared` (2026-09-06)

**Context.** The dashboard's `EventSource` must register one listener per SSE event name; `EventSource` has no wildcard. The list lived only in `apps/api/src/bus/event-bus.ts`, which `apps/web` cannot import.
**Options.** (a) duplicate the list in the web app; (b) move it to `@aegis/shared` and re-export it from the API; (c) have the API expose the list over HTTP at boot.
**Choice.** (b). `packages/shared/src/domain/bus-events.ts` exports `BUS_EVENT_NAMES`/`BusEventName`; the API re-exports them so no call site changed. A renamed event now fails typecheck in both packages.
**Consequences.** `@aegis/shared` stays dependency-light (a `const` tuple). The SSE contract in `Flow.md` F10 names the shared module as the source of truth.

### D-060 · `/api/v1/system` carries env, version and the simulation flag (2026-09-06)

**Context.** Checklist 17.3 has the top-bar pills read "provider/model, env" from `/api/v1/system`, but the T8 route returned only the LLM description.
**Choice.** Add `env` (`NODE_ENV`), `version` (`AEGIS_VERSION`) and `simulated: true` to the response; the route still touches no database and leaks no credentials. `simulated` is a constant because every outbound effect in this build is simulated (C-B7) and the pill says so (`LOCAL · SIM`).
**Consequences.** `system.test.ts` pins the new shape; the Run demo button hides itself when `env === 'production'` because the sim routes are not mounted there (C-D5).

### D-061 · Web toolchain: vitest for pure logic, hand-drawn icons, no data-fetching library (2026-09-06)

**Context.** T17 needs unit tests for formatting and the SSE helpers (T22 adds `prismGeometry.test.ts`), an icon set for the navigation, and a client-side data strategy for live pages.
**Choice.** `vitest ~5.0.0` as an `apps/web` devDependency (same version as the other packages; config in `vitest.config.mts`, `environment: node`, `src/**/*.test.ts`). Icons are 24px inline SVG paths in `components/ui/icons.tsx` (C-E4: no `lucide-react`/`@heroicons`). Pages fetch through the typed `lib/api.ts` result type and merge SSE envelopes into local React state; no SWR/React Query (Flow.md F10 corrected accordingly).
**Consequences.** `pnpm test` now runs 8 web tests. Adding an icon means adding a path, not a package. If a page ever needs request deduplication across components, that is the moment to revisit a cache library, with a new entry here.

### D-062 · Sprint 3 (T17–T22) is built by Claude as Lead Frontend Developer (2026-09-06)

**Context.** After the Sprint 2 batch (D-052) the project owner moved the frontend tasks to Claude and asked for a continuous run of T17–T22.
**Choice.** Claude implements the six tasks in order, one commit and one `task-NN-done` tag per task, with the same verification bar Codex was held to (`pnpm typecheck && pnpm test && pnpm lint`, Chrome checks recorded in `TestChecklist.md`). Design decisions follow `Design.md` exactly where it pins an axis; where it leaves one free, the choice and its reason are recorded in `Design.md` "Status" so a reviewer can diff intent against implementation.
**Consequences.** The Verification Agent and the implementer are the same model for this sprint; the compensating control is that every claim in `Bug-Feature.md` cites a command or a Chrome observation, never "it works".

