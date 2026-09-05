# Architecture — Aegis, The Agentic Merchant OS for Razorpay

> High-level map of the system: modules, database schema, data movement, AI boundary.
> Maintained by the Architect (Claude). Codex updates the "Status" markers when a task lands.
> Companion docs: `Flow.md` (execution paths), `Decisions.md` (why), `Constraints.md` (never-do list), `Design.md` (UI), `Checklist.md` (tasks).

## 1. What Aegis is

Aegis is an **event-driven AI control plane** that sits on top of a merchant's Razorpay account. It listens to the webhook stream, reconciles it idempotently into a local PostgreSQL state store, and routes problems to specialised, guard-railed action modules:

| Problem the merchant has | Aegis module | Track bar it clears |
|---|---|---|
| Cross-border card declines / 3DS failures / checkout abandonment | **Diagnostician** (AI) + **CheckoutRecovery** (WhatsApp retry link, localised) | Revenue Recovery: measured money recovered, stopping rules, audit trail |
| Failed subscription renewals | **SubscriptionSalvager** (dunning state machine) | Revenue Recovery + Growth |
| Expired B2B invoices / stalled deals | **B2BNegotiator** (bounded discount negotiation) | Growth: every money action explainable, bounded, gated |
| Chargebacks | **ChargebackEvidence** (evidence packet → human review) | Risk: defence-only, honest metrics, human in the loop |
| Selling to AI buyers | **x402 Gateway** (HTTP 402 challenge, simulated settlement) | Agentic Commerce |
| "What is happening in my business?" | **Ask Aegis** (Text-to-SQL + deterministic forecaster) | Finance Controller / observability |
| Catalog compliance risk | **ComplianceScanner** (LLM classification with keyword pre-screen) | Risk |

Everything that moves money is **deterministic code**. The LLM is used only where language understanding is the actual problem (see §10).

## 2. System map

```
                 ┌──────────────────────────────┐
  Simulator      │  scripts/simulate.ts          │  signs payloads with RAZORPAY_WEBHOOK_SECRET,
  (Razorpay      │  scenarios, duplicates,       │  replays duplicates, fires concurrent bursts,
   stand-in)     │  bursts, chaos flags          │  chaos: llm_down, db_slow
                 └──────────────┬───────────────┘
                                │ POST /webhooks/razorpay  (raw body + X-Razorpay-Signature + x-razorpay-event-id)
                                ▼
┌──────────────────────────── apps/api (Fastify, port 4000) ─────────────────────────────────────┐
│  INGRESS  src/ingress/                                                                          │
│   verifySignature(raw, header)  → HMAC-SHA256, timingSafeEqual                                  │
│   idempotencyKey = x-razorpay-event-id ?? sha256(raw)                                           │
│   INSERT webhook_events ON CONFLICT (event_id) DO UPDATE duplicate_count+1  ──► 200 {duplicate} │
│   same tx: INSERT jobs(kind='process_event')  (transactional outbox)                            │
│                                                                                                 │
│  WORKER  src/worker/   N loops: SELECT … FROM jobs FOR UPDATE SKIP LOCKED  → backoff → DLQ       │
│                                │                                                                │
│  ORCHESTRATOR  src/orchestrator/EventOrchestrator.ts                                            │
│   1. load + validate payload (zod)          4. modules.filter(canHandle)                        │
│   2. project entity (FOR UPDATE, precedence) 5. propose → guard → persist action                │
│   3. ROUTES[event] → diagnose?              6. auto-execute | pending_approval | blocked        │
│        │                                                                                        │
│        ▼                                      ▼                                                 │
│  DIAGNOSTICIAN src/diagnosis/           ACTION MODULES src/modules/                             │
│   hints (deterministic) → LLM JSON       CheckoutRecovery · SubscriptionSalvager                │
│   → zod → cross-check rules → fallback   B2BNegotiator · ChargebackEvidence                     │
│                                                                                                 │
│  LLM  src/llm/  LlmClient { completeJson } ── anthropic | openai | stub  + Resilient wrapper     │
│  X402 src/x402/  402 challenge · X-PAYMENT verify · nonce replay guard · caps · ledger           │
│  NLQ  src/nlq/   schema doc → LLM SQL → AST validator → read-only role → forecast (math in TS)  │
│  COMPLIANCE src/compliance/  keyword pre-screen → LLM rubric → evidence-span check              │
│  BUS  src/bus/   in-process EventEmitter → GET /api/v1/stream (SSE)                             │
└───────────────────────────────┬──────────────────────────────┬──────────────────────────────────┘
                                │ SQL (pg)                     │ SSE + JSON
                                ▼                              ▼
                     PostgreSQL 16 (local)          apps/web (Next.js 16, port 3000)
                     roles: aegis (rw)              Overview · Events · Actions · Approvals ·
                            aegis_readonly (NLQ)    Ask Aegis · Compliance · x402 Lab · Settings
```

## 3. Repository layout (pnpm workspace)

```
/                       root docs (this file + 9 siblings), package.json, pnpm-workspace.yaml
├── apps/api            Fastify API + worker + all business logic (TypeScript, ESM, run with tsx)
│   └── src/
│       ├── server.ts         boot: config → db → app → worker → listen; graceful shutdown
│       ├── app.ts            buildApp(): plugins, routes, error handler (testable without listen)
│       ├── config.ts         zod-validated env → typed Config (fail fast on bad env)
│       ├── db/               pool.ts (rw + readonly pools), migrate.ts (runner), tx.ts (withTransaction)
│       ├── ingress/          razorpay-webhook route, signature.ts, reconciler.ts
│       ├── worker/           job-runner.ts (SKIP LOCKED loop), backoff.ts
│       ├── orchestrator/     EventOrchestrator.ts, routing.ts, types.ts (ActionModule etc.), projections/
│       ├── diagnosis/        diagnostician.ts, hints.ts, cross-check.ts, schema.ts
│       ├── modules/          checkout-recovery/, subscription-salvager/, b2b-negotiator/, chargeback-evidence/
│       ├── guardrails/       config.ts (guardrail_config loader), rules.ts (shared bound checks)
│       ├── llm/              client.ts (interface), anthropic.ts, openai.ts, stub.ts, resilient.ts, prompts/
│       ├── x402/             middleware.ts, facilitator.ts (sim), routes.ts
│       ├── nlq/              schema-doc.ts, validator.ts, service.ts, forecast.ts
│       ├── compliance/       keywords.ts, scanner.ts, rubric.ts
│       ├── bus/              event-bus.ts, sse-route.ts
│       ├── routes/           api/v1/* read endpoints, approvals, metrics, sim (dev only)
│       └── observability/    logger.ts (pino, PII redaction), metrics.ts
├── apps/web             Next.js 16 App Router dashboard (see Design.md)
├── packages/shared      zod schemas for Razorpay payloads, domain enums, money helpers, API types
├── db/migrations        NNNN_name.sql + NNNN_name.down.sql (plain SQL, applied by apps/api migrate runner)
├── db/seed              seed.ts: customers, products (with risky descriptions), guardrail defaults
└── scripts              bootstrap-system.sh (sudo), bootstrap-db.sh, setup.sh, simulate.ts, demo.sh
```

## 4. Runtime processes and ports

| Process | Command | Port | Notes |
|---|---|---|---|
| API + worker | `pnpm --filter @aegis/api dev` | 4000 | one Node process; worker loops start after migrations check |
| Web | `pnpm --filter @aegis/web dev` | 3000 | calls API via `NEXT_PUBLIC_API_URL` |
| PostgreSQL 16 | systemd `postgresql` | 5432 | local only, password auth on localhost |
| Simulator | `pnpm sim <scenario>` | — | POSTs signed webhooks to the API |

## 5. Core interfaces (source of truth for Codex tasks)

```ts
// apps/api/src/orchestrator/types.ts
export type EntityType = 'payment' | 'order' | 'subscription' | 'invoice' | 'dispute';

export interface EventContext {
  event: WebhookEventRow;                 // persisted ingress row
  payload: RazorpayWebhook;               // zod-validated (packages/shared)
  entity: EntitySnapshot;                 // { type, row, customer } loaded under FOR UPDATE
  diagnosis: Diagnosis | null;            // only when ROUTES[event].diagnose === true
  config: GuardrailConfig;                // snapshot loaded at job start (bounds)
  now: Date;                              // injected clock (deterministic tests)
  logger: Logger;
}

export interface ActionProposal {
  module: string;
  moduleVersion: string;
  idempotencyKey: string;                 // `${module}:${entityType}:${entityId}:${step}` — UNIQUE in actions
  entityType: EntityType;
  entityId: string;
  customerId?: string;
  kind: string;                           // 'whatsapp_retry_link' | 'dunning_retry' | 'discount_offer' | 'evidence_packet' | ...
  summary: string;                        // one line for the dashboard
  moneyImpactPaise: number;               // <= 0: cost to merchant (discount); never positive
  expectedRecoveryPaise: number;          // >= 0: what we hope to recover (reporting only)
  requiresApproval: boolean;              // module opinion; orchestrator ORs with config.auto_approve_limit_paise
  payload: Record<string, unknown>;       // EXACT outbound payload (e.g. WhatsApp JSON) — printed to the log
  explanation: string[];                  // ordered, human-readable reasons
  scheduleFollowUp?: { kind: string; runAt: Date; payload: Record<string, unknown>; dedupeKey: string };
}

export interface GuardRule { rule: string; limit: unknown; actual: unknown; pass: boolean; note?: string }
export interface GuardResult { pass: boolean; rules: GuardRule[]; blockedReason?: string }

export interface ExecutionDeps { db: Db; bus: EventBus; llm: LlmClient; now: Date; logger: Logger }
export interface ExecutionResult {
  status: 'executed' | 'failed';
  result: Record<string, unknown>;
  outbound?: OutboundMessageDraft;        // persisted to outbound_messages with status 'simulated_sent'
  ledger?: LedgerEntryDraft[];            // persisted to ledger_entries
  error?: string;
}

export interface ActionModule {
  readonly name: string;                  // snake_case, stable (used in idempotency keys)
  readonly version: string;               // bump when behaviour changes
  readonly handles: readonly string[];    // Razorpay event types (deterministic subscription)
  canHandle(ctx: EventContext): boolean;                                  // pure
  propose(ctx: EventContext): Promise<ActionProposal | null>;             // may call LLM for TEXT only
  guard(proposal: ActionProposal, ctx: EventContext): GuardResult;        // pure, no I/O
  execute(action: ActionRow, ctx: EventContext, deps: ExecutionDeps): Promise<ExecutionResult>;
  compensate?(action: ActionRow, deps: ExecutionDeps): Promise<void>;     // undo (Rollback.md)
}

// apps/api/src/llm/client.ts
export type LlmPurpose =
  | 'diagnose_payment_failure' | 'diagnose_subscription_failure'
  | 'draft_negotiation_message' | 'draft_evidence_narrative'
  | 'text_to_sql' | 'summarize_query_result' | 'nl_to_forecast_spec'
  | 'classify_compliance';
export interface LlmJsonRequest<T> { purpose: LlmPurpose; system: string; user: string; schema: z.ZodType<T>; maxTokens?: number; tier?: 'default' | 'fast' }
export interface LlmJsonResult<T> { data: T; provider: string; model: string; latencyMs: number; tokensIn: number; tokensOut: number; raw: string }
export interface LlmClient { readonly provider: string; completeJson<T>(req: LlmJsonRequest<T>): Promise<LlmJsonResult<T>> }
export class LlmUnavailableError extends Error {}   // callers MUST catch and fall back to deterministic rules
```

## 6. Database schema (PostgreSQL 16) — target state

Conventions: money is `bigint` **paise**; timestamps `timestamptz`; Razorpay ids are natural keys (`pay_…`, `sub_…`); status columns use `CHECK` constraints (not PG enums) so migrations stay additive; every table has `created_at`; mutable tables have `updated_at`.

| Table | Purpose | Key columns |
|---|---|---|
| `schema_migrations` | applied migration versions | `version` PK, `applied_at` |
| `webhook_events` | **idempotent ingress log** | `event_id` UNIQUE (x-razorpay-event-id or sha256 body), `event_type`, `payload` jsonb, `payload_sha256`, `signature_valid`, `rzp_created_at`, `received_at`, `duplicate_count`, `last_duplicate_at`, `status` ∈ received/processing/processed/failed/dead_letter/ignored, `processed_at`, `last_error` |
| `jobs` | **transactional outbox / work queue** | `kind`, `payload`, `dedupe_key` UNIQUE, `status` ∈ queued/running/succeeded/failed/dead_letter/cancelled, `attempts`, `max_attempts`, `run_at`, `locked_by`, `locked_at`, `last_error`; partial index on (status, run_at) WHERE queued |
| `customers` | projection + preferences | `id` PK, `name`, `email`, `contact`, `country`, `locale` (default en-IN), `opted_out`, `notes` |
| `orders` | checkout projection | `id`, `customer_id`, `amount_paise`, `currency`, `status` ∈ created/attempted/paid/abandoned, `items`, `receipt`, `rzp_created_at` |
| `payments` | payment projection | `id`, `order_id`, `customer_id`, `amount_paise`, `status` ∈ created/authorized/captured/refunded/failed, `status_rank`, `method`, `card_network`, `card_type`, `card_issuer`, `card_country`, `international`, `error_code/description/source/step/reason`, `last_event_id`, `version` |
| `subscriptions` | subscription projection + salvage state | `id`, `plan_id`, `customer_id`, `status` ∈ created/authenticated/active/pending/halted/cancelled/completed/expired, `amount_paise`, `charge_at`, `paid_count`, `remaining_count`, `salvage_state` ∈ none/retry_scheduled/retrying/offer_sent/recovered/churned/escalated, `retry_count`, `next_retry_at`, `last_event_id`, `last_event_at`, `version` |
| `invoices` | B2B invoice projection + negotiation state | `id`, `customer_id`, `amount_paise`, `floor_amount_paise`, `status` ∈ issued/partially_paid/paid/expired/cancelled, `due_by`, `line_items`, `negotiation_state` ∈ none/offer_sent/countered/accepted/rejected/expired/escalated, `negotiation_round`, `current_offer_paise`, `last_event_id`, `version` |
| `disputes` | chargeback projection | `id`, `payment_id`, `amount_paise`, `reason_code`, `reason_description`, `phase` ∈ fraud/retrieval/chargeback/pre_arbitration/arbitration, `status` ∈ open/under_review/won/lost/closed, `respond_by` |
| `evidence_packets` | assembled evidence, paused for humans | `dispute_id` UNIQUE, `packet` jsonb, `narrative` text (LLM), `review_status` ∈ requires_human_review/approved/rejected/submitted, `reviewed_by`, `reviewed_at`, `review_note`, `submitted_at` |
| `diagnoses` | every AI diagnosis, auditable | `event_id`, `entity_type`, `entity_id`, `hints` jsonb (deterministic), `provider`, `model`, `prompt_version`, `input_digest`, `output` jsonb (validated + cross_check), `root_cause`, `confidence`, `strategy`, `rationale`, `degraded`, `degraded_reason`, `latency_ms`, `tokens_in`, `tokens_out` |
| `actions` | **the audit trail of every proposed money/customer action** | `idempotency_key` UNIQUE, `module`, `module_version`, `trigger_event_id`, `diagnosis_id`, `entity_type`, `entity_id`, `customer_id`, `kind`, `summary`, `proposal` jsonb, `bounds` jsonb (GuardRule[]), `money_impact_paise`, `expected_recovery_paise`, `requires_approval`, `status` ∈ proposed/blocked/pending_approval/approved/rejected/executed/failed/expired/compensated, `reason`, `decided_by`, `decided_at`, `executed_at`, `result` jsonb |
| `outbound_messages` | simulated sends (the "frontend log") | `action_id`, `channel` ∈ whatsapp/email/sms, `recipient_masked`, `locale`, `template`, `payload` jsonb, `status` ∈ simulated_sent/suppressed, `suppressed_reason` |
| `ledger_entries` | money impact ledger (deterministic) | `account` (recovered_revenue / discount_granted / x402_revenue / chargeback_exposure), `debit_paise`, `credit_paise`, `currency`, `ref_type`, `ref_id`, `memo` |
| `products` | merchant catalog (compliance + x402) | `id`, `merchant_id`, `name`, `description`, `category`, `price_paise`, `sku`, `active`, `agent_purchasable` |
| `compliance_scan_runs` | scan batches | `started_at`, `finished_at`, `products_scanned`, `flags_created`, `provider`, `model`, `degraded_count`, `status` |
| `compliance_flags` | flagged descriptions | `product_id`, `scan_run_id`, `keyword_hits` jsonb, `llm_assessment` jsonb, `risk_level` ∈ none/low/medium/high/prohibited, `category`, `evidence_span`, `recommendation`, `status` ∈ open/acknowledged/resolved/false_positive/needs_review` |
| `x402_payments` | challenge → verify → settle | `nonce` UNIQUE, `resource`, `method`, `payer`, `amount_paise`, `asset`, `network`, `status` ∈ challenged/verified/settled/rejected/expired, `reject_reason`, `payment_payload` jsonb, `expires_at`, `settled_at` |
| `nl_queries` | Text-to-SQL audit | `question`, `generated_sql`, `validated`, `validation_errors`, `executed`, `row_count`, `latency_ms`, `provider`, `model`, `degraded`, `summary`, `error` |
| `guardrail_config` | editable bounds (seeded) | `key` PK, `value` jsonb, `description`, `updated_by`, `updated_at` |
| `audit_log` | append-only human/system actions | `actor` (system / worker:<id> / ai:<provider>/<model> / human:<name>), `action`, `entity_type`, `entity_id`, `before`, `after`, `metadata` |

**Guardrail defaults (seeded into `guardrail_config`)**

| key | default | meaning |
|---|---|---|
| `kill_switch` | `false` | when true, every module returns `blocked`, x402 returns 503 |
| `auto_approve_limit_paise` | `200000` (₹2,000) | money impact above this always requires a human |
| `max_discount_pct` | `15` | hard ceiling for any negotiated discount |
| `max_negotiation_rounds` | `3` | negotiation stopping rule |
| `max_dunning_retries` | `3` | subscription salvage stopping rule |
| `dunning_schedule_hours` | `[24, 72, 168]` | retry offsets |
| `message_cooldown_hours` | `24` | max one outbound message per customer per window |
| `quiet_hours_local` | `{"start":21,"end":8}` | never message inside the customer's local quiet hours |
| `daily_discount_budget_paise` | `5000000` (₹50,000) | batch-level stopping rule |
| `attribution_window_hours` | `72` | a capture within this window after an action counts as recovered |
| `x402_max_amount_paise` | `100000` (₹1,000) | per-request cap on the agent gateway |
| `x402_daily_cap_per_payer_paise` | `500000` | per-payer daily cap |

## 7. Lifecycles (state machines — all deterministic code)

- **webhook_events.status**: `received → processing → processed | failed(retry) → dead_letter`; unknown event types → `ignored`.
- **jobs.status**: `queued → running → succeeded | failed(→ queued with backoff 2^attempts·5s) → dead_letter` after `max_attempts`.
- **payments.status precedence** (out-of-order guard): rank created=0, authorized=1, failed=1 (terminal), captured=2, refunded=3. Apply an incoming status only if current is not `failed` and `incoming.rank >= current.rank`. Same event twice is a no-op (idempotent).
- **subscriptions**: last-writer wins by `rzp_created_at` of the event (`incoming.created_at >= last_event_at`), because Razorpay subscription states legitimately oscillate (`active ↔ pending`).
- **salvage_state**: `none → retry_scheduled → retrying → (recovered | retry_scheduled…) → offer_sent → (recovered | churned) ; any → escalated`. Max `max_dunning_retries`; each transition is an `actions` row.
- **negotiation_state**: `none → offer_sent → (accepted | countered → offer_sent … | rejected | expired) ; round > max → escalated`. Every offer is bounded by `floor_amount_paise` and `max_discount_pct`, amounts computed in TypeScript, never by the LLM.
- **actions.status**: `proposed → blocked` (guard failed) | `→ pending_approval` (needs human) `→ approved → executed | failed` | `→ rejected`; `executed → compensated` via `compensate()`.
- **evidence_packets.review_status**: `requires_human_review → approved → submitted` | `→ rejected`. Nothing is ever auto-submitted.
- **x402_payments.status**: `challenged → verified → settled` | `→ rejected` (bad signature, amount < required, nonce reuse, cap exceeded, kill switch) | `→ expired`.

## 8. Concurrency and idempotency design

1. **Ingress idempotency**: `INSERT … ON CONFLICT (event_id) DO UPDATE SET duplicate_count = duplicate_count + 1, last_duplicate_at = now() RETURNING (xmax = 0) AS inserted`. Duplicates return `200 {"status":"duplicate"}` fast (Razorpay retries on non-2xx, so we must ack).
2. **Transactional outbox**: the event row and its `process_event` job are inserted in one transaction; a crash between them is impossible.
3. **Worker**: `UPDATE jobs SET status='running', locked_by=$1, locked_at=now(), attempts=attempts+1 WHERE id = (SELECT id FROM jobs WHERE status='queued' AND run_at <= now() ORDER BY run_at, id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`. Stale `running` rows older than `lock_timeout` are re-queued by a sweeper.
4. **Per-entity serialisation**: the orchestrator opens a transaction and `SELECT … FOR UPDATE` on the entity row before projecting or proposing; two events for the same payment are processed one after the other, events for different entities in parallel.
5. **Action idempotency**: `actions.idempotency_key` UNIQUE; re-processing a job after a crash cannot double-propose.
6. **Signature first**: signature is verified before anything is written; invalid signatures are recorded (`signature_valid=false`, `status='ignored'`) and answered `401` — visible in the dashboard, never processed.

## 9. AI boundary map

| Capability | Who does it | Why |
|---|---|---|
| Webhook parsing, signature, dedupe, routing | deterministic | correctness and security cannot be probabilistic |
| Entity projection, status precedence | deterministic | ledger-grade state |
| Payment-failure hints (`error_step`, `international`, `method`) | deterministic | structured fields already tell us most of the story |
| Root-cause narrative + intervention **choice among an enum** | LLM (JSON, zod-validated, cross-checked) | the free-text `error_description` and cross-signal reasoning are language problems |
| Locale selection, template selection, retry link creation | deterministic | compliance: customer copy comes from approved templates |
| Discount amount, floor, rounds, budgets | deterministic | **never use AI for math or money** |
| B2B negotiation message wording | LLM (text only; numbers injected by code) | persuasion is language |
| Evidence packet fields | deterministic | facts come from the DB |
| Evidence narrative summary | LLM | summarisation |
| Approval decisions | human | gated by design |
| Text-to-SQL | LLM → AST validator → read-only role | code-gen is a language problem; execution is sandboxed |
| Forecast numbers | deterministic (linear regression + moving average in TS) | never use AI for math |
| Compliance classification | keyword pre-screen (deterministic) + LLM rubric with evidence-span verification | unstructured text |
| x402 challenge/verify/settle | deterministic | money |

## 10. Frontend (summary — full spec in Design.md)

Next.js 16 App Router, Tailwind 4, `next-themes` (system default + manual toggle). Pages: `/` Overview (KPIs + prism hero), `/events` live feed (SSE), `/actions` audit trail with outbound payloads, `/approvals` (chargeback evidence + offers awaiting a human), `/ask` Ask Aegis (NL → SQL → table + forecast chart), `/compliance`, `/x402` gateway lab, `/settings` guardrails. Every page renders the footer **"Made with 💖 by Nabhanyu for Razorpay AI Buildathon"**.

## 11. Security model

- HMAC-SHA256 webhook verification on the **raw** body with `crypto.timingSafeEqual`; secrets only via env (`.env`, never committed).
- Read-only Postgres role for AI-generated SQL, with column-level grants that exclude PII (`customers.name/email/contact`, `payments.email/contact`), `default_transaction_read_only = on`, `statement_timeout = 5s`, result `LIMIT 200`.
- SQL validated as a single `SELECT` via `pgsql-ast-parser` before execution; denylisted functions (`pg_sleep`, `pg_read_file`, `lo_*`, `dblink`, `copy`) and system schemas rejected.
- Rate limit on ingress and x402 (`@fastify/rate-limit`), request-id on every log line, PII masked in logs and in `outbound_messages.recipient_masked`.
- Kill switch (`guardrail_config.kill_switch`) blocks all money actions and the gateway.
- Dev-only simulation routes are mounted only when `NODE_ENV !== 'production'`.

## 12. What is simulated (and how honestly)

| Simulated | How | What is real |
|---|---|---|
| Razorpay webhooks | `scripts/simulate.ts` builds payloads in Razorpay's documented shape and signs them with the same HMAC scheme | the ingress code is the real thing; point real webhooks at it and it works |
| WhatsApp send | payload built in Meta Cloud API template shape, persisted + shown in the log, never sent | template selection, localisation, cooldown/quiet-hour guardrails |
| x402 facilitator | local HMAC-signed payment payloads, server-issued nonces | 402 challenge shape, replay protection, caps, ledger |
| Merchant catalog / customers | seeded rows | everything downstream |
| LLM | `stub` provider replays deterministic fixtures when no key is present | the real adapters (`anthropic`, `openai`) are exercised when keys exist |

## 13. Status

| Area | Status |
|---|---|
| Task 1 — environment + scaffold | **done by Claude** (see `Checklist.md` T1) |
| Task 2 — migrations + core schema + seed | **done by Codex, verified by Claude** (see `Checklist.md` T2, `TestChecklist.md` §T2) |
| Everything else | planned; see `Checklist.md` and the Status column in `Bug-Feature.md` |
