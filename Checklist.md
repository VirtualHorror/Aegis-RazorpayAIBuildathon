# Aegis Implementation Checklist

> **For agentic workers (Codex):** you get ONE task per handoff. Read `AGENTS.md`, then `Constraints.md`, then this task. Do not start the next task. When done, run the task's verification block, update the docs listed under "Docs", commit, and stop. The Verification Agent (Claude) reviews and unlocks the next task.
> Checkbox syntax (`- [ ]`) tracks progress; tick boxes as you go.

**Goal:** Aegis — an event-driven AI control plane on top of a Razorpay account: idempotent webhook reconciliation → AI diagnosis → guard-railed action modules → human approvals → observability (Text-to-SQL, compliance) and an x402 gateway for AI buyers.

**Architecture:** see `Architecture.md` (system map §2, interfaces §5, schema §6, lifecycles §7). Execution paths: `Flow.md`. UI: `Design.md`.

**Tech stack:** Node 24 LTS · pnpm 11 · TypeScript 5.9 · Fastify 5 · PostgreSQL 16 (`pg`) · zod 4 · vitest 5 · Next.js 16 · React 19 · Tailwind 4 · next-themes · vgpu (T22 only) · `@anthropic-ai/sdk` + `openai` SDKs.

**Spec:** `Architecture.md`, `Design.md`, `Constraints.md` (this plan argues from those).

## Global constraints (apply to every task)

- Package names: `@aegis/api`, `@aegis/web`, `@aegis/shared`. Ports: API 4000, web 3000, Postgres 5432.
- Env variables are the ones in `.env.example`; new ones must be added there **and** to `apps/api/src/config.ts` (zod) in the same task.
- Money = integer paise (`bigint` in SQL, `number` in TS via `assertSafePaise`). Never floats. Never AI for numbers. (`Constraints.md` C-A1, C-B6)
- Every LLM call: `LlmClient.completeJson` + zod schema + `LlmUnavailableError` fallback. (C-A2, C-A4)
- Every proposed customer/money action = `actions` row with `bounds` before execution. (C-B1)
- Every non-obvious block carries `// Intent:` and `// Flow:` comments. (C-E1)
- `pnpm typecheck && pnpm test && pnpm lint` green before "done". One commit per task: `feat(tNN): <summary>`; then `git tag task-NN-done`.
- Footer text on every page: `Made with 💖 by Nabhanyu for Razorpay AI Buildathon`.
- Docs to update in **every** task: `Flow.md` (flip `[planned]` → `[live]`, correct names), `Bug-Feature.md` (status + evidence), `TestChecklist.md` (make the pending section real). `Decisions.md` if you chose something not in the plan.

## Phase map

| Phase | Tasks | Outcome |
|---|---|---|
| 0 Foundation | T1 (Claude) | machine + repo run |
| 1 Data & ingress | T2 T3 T4 T5 | webhooks reconciled idempotently, projections correct under concurrency, simulator |
| 2 Brain | T6 T7 T8 | LLM abstraction, diagnostician, orchestrator + audit + SSE |
| 3 Action modules | T9 T10 T11 T12 T13 | four guard-railed modules, approvals, ledger, metrics |
| 4 Agentic commerce | T14 | x402 gateway |
| 5 Observability | T15 T16 | Ask Aegis (Text-to-SQL + forecast), compliance scanner |
| 6 Frontend | T17 T18 T19 T20 T21 T22 | the dashboard, flourishes |
| 7 Ship | T23 T24 | demo storyboard, README, hardening |

---

### Task 1: Bare-metal environment + monorepo scaffold — **DONE by Claude (2026-09-05)**

**Outcome.** Node 24.20.0 + pnpm 11.25.0 (user-level, nvm), `scripts/bootstrap-system.sh` (sudo: apt packages, PostgreSQL 16, roles, databases), pnpm workspace with `apps/api` (Fastify, `/health` with DB probe, config loader, migration runner), `apps/web` (Next.js 16, footer, theme toggle), `packages/shared` (money helpers + precedence stubs + tests), vitest, typecheck, git initialised.

- [x] 1.1 User-level toolchain: `nvm` v0.40.7 → Node 24 LTS → `npm i -g pnpm`.
- [x] 1.2 `scripts/bootstrap-system.sh` (idempotent, needs sudo): `apt-get install build-essential postgresql-16 postgresql-contrib`, enable service, then `scripts/bootstrap-db.sh` creates roles `aegis` (login, password), `aegis_readonly` (login, `default_transaction_read_only=on`, `statement_timeout=5s`) and DBs `aegis`, `aegis_test` owned by `aegis`.
- [x] 1.3 Workspace: root `package.json` (scripts: dev, build, test, typecheck, lint, db:migrate, db:migrate:down, db:seed, sim, demo), `pnpm-workspace.yaml`, `.nvmrc`, `.npmrc`, `.editorconfig`, `.gitignore`, `.env.example`, `tsconfig.base.json`.
- [x] 1.4 `packages/shared`: `money.ts` (`assertSafePaise`, `paise`, `addPaise`, `pctOf`), `domain/precedence.ts`, `domain/enums.ts`, tests.
- [x] 1.5 `apps/api`: `config.ts`, `db/pool.ts`, `db/migrate.ts` (+ `.down` support, checksum), `app.ts`, `server.ts`, `routes/health.ts`, tests.
- [x] 1.6 `apps/web`: Next.js 16 App Router, Tailwind 4, `next-themes` provider, `ThemeToggle`, footer in `layout.tsx`, landing page showing API health.
- [x] 1.7 `git init`, initial commit, tag `task-01-done`.
- [ ] 1.8 **Human step (needs password):** `sudo bash scripts/bootstrap-system.sh` → then `pg_isready` and the DB lines of `TestChecklist.md §T1` pass.

---

### Task 2: Migration runner hardening + core schema + seed — **DONE by Codex (2026-09-05) · verified GREEN by Claude (2026-09-05)**

**Goal.** Every table in `Architecture.md §6` exists via numbered SQL migrations with down files; read-only role has PII-excluding grants; seed data makes the demo realistic.

**Why it matters.** Evaluators open the schema first. Column-level grants for the AI SQL role are a concrete "AI judgement" artefact.

**Files.**
- Create: `db/migrations/0001_init.sql`, `db/migrations/0001_init.down.sql`, `db/migrations/0002_readonly_grants.sql`, `db/migrations/0002_readonly_grants.down.sql`
- Create: `db/seed/seed.ts`, `db/seed/data/customers.ts`, `db/seed/data/products.ts`, `db/seed/data/guardrails.ts`
- Modify: `apps/api/src/db/migrate.ts` (already runs `*.sql` in order and records `schema_migrations`; add `down` for the last version and `--status`)
- Create: `apps/api/src/db/repos/guardrails.ts` (`loadGuardrailConfig(db): Promise<GuardrailConfig>`), `apps/api/src/guardrails/types.ts`
- Test: `apps/api/src/db/migrate.test.ts` (extend), `apps/api/test/schema.integration.test.ts`

**Interfaces.**
- Produces `GuardrailConfig` (typed from the seeded keys — see table in `Architecture.md §6`), `loadGuardrailConfig`.
- Produces `pnpm db:migrate`, `pnpm db:migrate:down`, `pnpm db:migrate -- --status`, `pnpm db:seed`.

**Steps.**
- [x] 2.1 Write `0001_init.sql` — exactly this DDL (add `-- Intent:` comments per table):
```sql
CREATE TABLE webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  account_id text,
  payload jsonb NOT NULL,
  payload_sha256 text NOT NULL,
  signature_valid boolean NOT NULL,
  rzp_created_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  duplicate_count integer NOT NULL DEFAULT 0,
  last_duplicate_at timestamptz,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','processing','processed','failed','dead_letter','ignored')),
  processed_at timestamptz,
  last_error text
);
CREATE INDEX webhook_events_type_received_idx ON webhook_events (event_type, received_at DESC);

CREATE TABLE jobs (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text UNIQUE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','dead_letter','cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  run_at timestamptz NOT NULL DEFAULT now(),
  locked_by text,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_poll_idx ON jobs (run_at, id) WHERE status = 'queued';

CREATE TABLE customers (
  id text PRIMARY KEY, name text, email text, contact text, country text,
  locale text NOT NULL DEFAULT 'en-IN', opted_out boolean NOT NULL DEFAULT false,
  notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE orders (
  id text PRIMARY KEY, customer_id text REFERENCES customers(id),
  amount_paise bigint NOT NULL CHECK (amount_paise >= 0), currency text NOT NULL DEFAULT 'INR',
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','attempted','paid','abandoned')),
  receipt text, items jsonb NOT NULL DEFAULT '[]'::jsonb, notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  rzp_created_at timestamptz, last_event_id text REFERENCES webhook_events(event_id), version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payments (
  id text PRIMARY KEY, order_id text REFERENCES orders(id), customer_id text REFERENCES customers(id),
  amount_paise bigint NOT NULL CHECK (amount_paise >= 0), currency text NOT NULL DEFAULT 'INR',
  status text NOT NULL CHECK (status IN ('created','authorized','captured','refunded','failed')),
  status_rank smallint NOT NULL,
  method text, card_network text, card_type text, card_issuer text, card_country text,
  international boolean NOT NULL DEFAULT false,
  error_code text, error_description text, error_source text, error_step text, error_reason text,
  email text, contact text, notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  rzp_created_at timestamptz, last_event_id text REFERENCES webhook_events(event_id), version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE subscriptions (
  id text PRIMARY KEY, plan_id text, customer_id text REFERENCES customers(id),
  status text NOT NULL CHECK (status IN ('created','authenticated','active','pending','halted','cancelled','completed','expired')),
  amount_paise bigint NOT NULL CHECK (amount_paise >= 0), currency text NOT NULL DEFAULT 'INR',
  current_start timestamptz, current_end timestamptz, charge_at timestamptz,
  total_count integer, paid_count integer NOT NULL DEFAULT 0, remaining_count integer,
  salvage_state text NOT NULL DEFAULT 'none' CHECK (salvage_state IN ('none','retry_scheduled','retrying','offer_sent','recovered','churned','escalated')),
  retry_count integer NOT NULL DEFAULT 0, next_retry_at timestamptz,
  last_event_id text REFERENCES webhook_events(event_id), last_event_at timestamptz, version integer NOT NULL DEFAULT 1,
  notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE invoices (
  id text PRIMARY KEY, customer_id text REFERENCES customers(id),
  amount_paise bigint NOT NULL CHECK (amount_paise >= 0), floor_amount_paise bigint NOT NULL CHECK (floor_amount_paise >= 0),
  currency text NOT NULL DEFAULT 'INR',
  status text NOT NULL CHECK (status IN ('issued','partially_paid','paid','expired','cancelled')),
  due_by timestamptz, line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  negotiation_state text NOT NULL DEFAULT 'none' CHECK (negotiation_state IN ('none','offer_sent','countered','accepted','rejected','expired','escalated')),
  negotiation_round integer NOT NULL DEFAULT 0, current_offer_paise bigint,
  notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  rzp_created_at timestamptz, last_event_id text REFERENCES webhook_events(event_id), version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE disputes (
  id text PRIMARY KEY, payment_id text REFERENCES payments(id),
  amount_paise bigint NOT NULL CHECK (amount_paise >= 0), currency text NOT NULL DEFAULT 'INR',
  reason_code text, reason_description text,
  phase text NOT NULL CHECK (phase IN ('fraud','retrieval','chargeback','pre_arbitration','arbitration')),
  status text NOT NULL CHECK (status IN ('open','under_review','won','lost','closed')),
  respond_by timestamptz, last_event_id text REFERENCES webhook_events(event_id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE evidence_packets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dispute_id text NOT NULL UNIQUE REFERENCES disputes(id),
  packet jsonb NOT NULL, narrative text,
  review_status text NOT NULL DEFAULT 'requires_human_review' CHECK (review_status IN ('requires_human_review','approved','rejected','submitted')),
  reviewed_by text, reviewed_at timestamptz, review_note text, submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE diagnoses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id text NOT NULL REFERENCES webhook_events(event_id),
  entity_type text NOT NULL, entity_id text NOT NULL,
  hints jsonb NOT NULL, provider text NOT NULL, model text NOT NULL, prompt_version text NOT NULL, input_digest text NOT NULL,
  output jsonb NOT NULL, root_cause text NOT NULL, confidence numeric(4,3) NOT NULL, strategy text NOT NULL, rationale text NOT NULL,
  degraded boolean NOT NULL DEFAULT false, degraded_reason text, latency_ms integer, tokens_in integer, tokens_out integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX diagnoses_entity_idx ON diagnoses (entity_type, entity_id, created_at DESC);
CREATE TABLE actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), idempotency_key text NOT NULL UNIQUE,
  module text NOT NULL, module_version text NOT NULL,
  trigger_event_id text REFERENCES webhook_events(event_id), diagnosis_id uuid REFERENCES diagnoses(id),
  entity_type text NOT NULL, entity_id text NOT NULL, customer_id text,
  kind text NOT NULL, summary text NOT NULL, proposal jsonb NOT NULL, bounds jsonb NOT NULL DEFAULT '[]'::jsonb,
  money_impact_paise bigint NOT NULL DEFAULT 0 CHECK (money_impact_paise <= 0),
  expected_recovery_paise bigint NOT NULL DEFAULT 0 CHECK (expected_recovery_paise >= 0),
  requires_approval boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('proposed','blocked','pending_approval','approved','rejected','executed','failed','expired','compensated')),
  reason text, decided_by text, decided_at timestamptz, executed_at timestamptz, result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX actions_status_idx ON actions (status, created_at DESC);
CREATE INDEX actions_entity_idx ON actions (entity_type, entity_id);
CREATE TABLE outbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), action_id uuid NOT NULL REFERENCES actions(id),
  channel text NOT NULL CHECK (channel IN ('whatsapp','email','sms')), recipient_masked text NOT NULL, locale text NOT NULL,
  template text NOT NULL, payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('simulated_sent','suppressed')), suppressed_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ledger_entries (
  id bigserial PRIMARY KEY, account text NOT NULL,
  debit_paise bigint NOT NULL DEFAULT 0 CHECK (debit_paise >= 0), credit_paise bigint NOT NULL DEFAULT 0 CHECK (credit_paise >= 0),
  currency text NOT NULL DEFAULT 'INR', ref_type text NOT NULL, ref_id text NOT NULL, memo text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entries_account_idx ON ledger_entries (account, created_at DESC);
CREATE TABLE products (
  id text PRIMARY KEY, merchant_id text NOT NULL, name text NOT NULL, description text NOT NULL, category text,
  price_paise bigint NOT NULL CHECK (price_paise >= 0), currency text NOT NULL DEFAULT 'INR', sku text,
  active boolean NOT NULL DEFAULT true, agent_purchasable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE compliance_scan_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  products_scanned integer NOT NULL DEFAULT 0, flags_created integer NOT NULL DEFAULT 0,
  provider text, model text, degraded_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed'))
);
CREATE TABLE compliance_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id text NOT NULL REFERENCES products(id),
  scan_run_id uuid REFERENCES compliance_scan_runs(id),
  keyword_hits jsonb NOT NULL DEFAULT '[]'::jsonb, llm_assessment jsonb,
  risk_level text NOT NULL CHECK (risk_level IN ('none','low','medium','high','prohibited')),
  category text NOT NULL, evidence_span text, recommendation text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','false_positive','needs_review')),
  reviewed_by text, reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE x402_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nonce text NOT NULL UNIQUE,
  resource text NOT NULL, method text NOT NULL, payer text,
  amount_paise bigint NOT NULL CHECK (amount_paise >= 0), asset text NOT NULL DEFAULT 'INR', network text NOT NULL DEFAULT 'aegis-sim',
  status text NOT NULL CHECK (status IN ('challenged','verified','settled','rejected','expired')),
  reject_reason text, payment_payload jsonb, request_id text, expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), settled_at timestamptz
);
CREATE TABLE nl_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), question text NOT NULL, generated_sql text,
  validated boolean NOT NULL DEFAULT false, validation_errors jsonb, executed boolean NOT NULL DEFAULT false,
  row_count integer, latency_ms integer, provider text, model text, degraded boolean NOT NULL DEFAULT false,
  summary text, error text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE guardrail_config (
  key text PRIMARY KEY, value jsonb NOT NULL, description text NOT NULL,
  updated_by text NOT NULL DEFAULT 'seed', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY, actor text NOT NULL, action text NOT NULL,
  entity_type text NOT NULL, entity_id text NOT NULL, before jsonb, after jsonb, metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
```
- [x] 2.2 `0001_init.down.sql`: `DROP TABLE IF EXISTS … CASCADE` in reverse dependency order.
- [x] 2.3 `0002_readonly_grants.sql`: `GRANT USAGE ON SCHEMA public TO aegis_readonly;` then `GRANT SELECT ON webhook_events, jobs, orders, subscriptions, invoices, disputes, evidence_packets, diagnoses, actions, outbound_messages, ledger_entries, products, compliance_scan_runs, compliance_flags, x402_payments, nl_queries, guardrail_config, audit_log TO aegis_readonly;` and **column-level** grants: `GRANT SELECT (id, country, locale, opted_out, created_at, updated_at) ON customers TO aegis_readonly; GRANT SELECT (id, order_id, customer_id, amount_paise, currency, status, method, card_network, card_type, card_country, international, error_code, error_source, error_step, error_reason, rzp_created_at, created_at) ON payments TO aegis_readonly;`. Down: `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM aegis_readonly;`. The migration must be skipped with a logged warning when the role does not exist (test DB on CI), never fail.
- [x] 2.4 Migration runner (`apps/api/src/db/migrate.ts`) already supports `up`, `down` (runs `<version>_<name>.down.sql` for the latest applied version in a transaction and deletes its `schema_migrations` row), `status`, and refuses to run when an applied file's checksum drifted. Do not rewrite it; add the integration tests (up → all tables exist → down → up round-trip; edit an applied file in the test DB copy → `migrateUp` throws `MigrationError` mentioning the version).
- [x] 2.5 Seed (`db/seed/seed.ts`, run with `tsx`, idempotent via `ON CONFLICT (id) DO UPDATE`): 12 customers spanning locales `en-IN, hi-IN, ta-IN, kn-IN, en-US, en-GB, en-AE, en-SG` with realistic masked contacts (`+91…`, `+1…`, `+44…`, `+971…`, `+65…`), two with `opted_out=true`; 16 products for merchant `acc_AegisDemo01` (electronics, apparel, SaaS plans, and **five deliberately risky descriptions**: "guaranteed 20% monthly returns", "cures diabetes in 30 days", "replica Rolex", "nicotine vape pods", "lottery ticket bundle"), 6 of them `agent_purchasable=true` with prices ₹99–₹999; guardrail defaults exactly as in `Architecture.md §6`; 3 invoices (₹4,20,000, ₹1,25,000, ₹60,000) with `floor_amount_paise = amount × 0.85`; 4 subscriptions (`active`), 6 orders. Print counts.
- [x] 2.6 `loadGuardrailConfig(db)`: `SELECT key, value FROM guardrail_config` → typed object; throw if any expected key is missing (fail fast, C-C5).
- [x] 2.7 Tests: unit — runner ordering, checksum mismatch, down file resolution; integration (`aegis_test`) — migrate up, all tables exist, migrate down/up round-trip, readonly role cannot select `customers.email` (skip with a message if role missing).
- [x] 2.8 Root scripts: `db:migrate`, `db:migrate:down`, `db:seed`, `db:backup` (`pg_dump $DATABASE_URL > backups/aegis-$(date +%s).sql`).

**Verify.** `TestChecklist.md §T2`.
**Docs.** `Flow.md` F1 (migrations at boot: the API refuses to start with pending migrations unless `AEGIS_ALLOW_PENDING_MIGRATIONS=true`), `Bug-Feature.md` F-004, `TestChecklist.md §T2`.

---

### Task 3: Idempotent webhook ingress (HMAC, dedupe, transactional outbox) — **DONE by Codex (2026-09-05) · verified GREEN by Claude (2026-09-05, after fixing B-004)**

**Goal.** `POST /webhooks/razorpay` verifies the signature on raw bytes, persists the event exactly once, enqueues exactly one job in the same transaction, and answers duplicates with `200 {"status":"duplicate"}`.

**Files.**
- Create: `packages/shared/src/razorpay/webhook.ts` (zod: envelope + `payment`, `order`, `subscription`, `invoice`, `dispute` entity schemas — use `.passthrough()` for unknown fields), `packages/shared/src/razorpay/events.ts` (`KNOWN_EVENT_TYPES` const array)
- Create: `apps/api/src/ingress/signature.ts`, `apps/api/src/ingress/raw-body.ts`, `apps/api/src/ingress/reconciler.ts`, `apps/api/src/ingress/razorpay-webhook.ts`, `apps/api/src/ingress/index.ts` (Fastify plugin, encapsulated)
- Create: `apps/api/src/db/repos/webhook-events.ts`, `apps/api/src/db/repos/jobs.ts` (`enqueue(tx, {kind, payload, dedupeKey, runAt?})`)
- Modify: `apps/api/src/app.ts` (register ingress plugin under `/webhooks`), `apps/api/src/config.ts` (`RAZORPAY_WEBHOOK_SECRET` min length 16)
- Test: `apps/api/src/ingress/signature.test.ts`, `apps/api/test/ingress.integration.test.ts`

**Interfaces.**
- Produces: `verifySignature(raw: Buffer, header: string | undefined, secret: string): boolean`, `computeSignature(raw: Buffer, secret: string): string` (hex).
- Produces: `reconcile(db, input: { eventId, eventType, accountId, payload, sha256, signatureValid, rzpCreatedAt }): Promise<{ inserted: boolean; duplicateCount: number; enqueued: boolean }>`.
- Produces: `enqueue(...)` used by T4/T10/T11/T16.

**Steps.**
- [x] 3.1 `signature.ts`:
```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
export function computeSignature(raw: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(raw).digest('hex');
}
// Intent: constant-time comparison; Flow: compute expected → length guard → timingSafeEqual.
export function verifySignature(raw: Buffer, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const expected = Buffer.from(computeSignature(raw, secret), 'utf8');
  const given = Buffer.from(header.trim(), 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
```
- [x] 3.2 `raw-body.ts`: inside the encapsulated ingress plugin, `fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => { (req as RawBodyRequest).rawBody = body; done(null, body) })` — do NOT JSON.parse here; the handler parses after signature verification. Declare the `rawBody` augmentation in `apps/api/src/types/fastify.d.ts`.
- [x] 3.3 Handler flow (`razorpay-webhook.ts`): rate limit 300/min; `signatureValid = verifySignature(raw, headers['x-razorpay-signature'], secret)`; `eventId = headers['x-razorpay-event-id'] ?? 'sha256:' + sha256(raw)`; `sha256 = sha256(raw)`; parse JSON (400 on invalid JSON only if signature valid; invalid signature → persist row with `status='ignored'`, `signature_valid=false`, `event_type='unknown'` when unparsable → `401 {"error":"invalid_signature"}`); `RazorpayWebhookSchema.safeParse` (on failure: persist `status='ignored'`, reason in `last_error`, respond `202 {"status":"ignored","reason":"schema"}`); `reconcile(...)`; publish to bus (T8 will add the bus; for now call an injectable `onEvent` hook defaulting to noop); respond `200 {"status": inserted ? "accepted" : "duplicate", "event_id": eventId, "duplicate_count": n}`.
- [x] 3.4 `reconciler.ts` in one transaction:
```sql
INSERT INTO webhook_events (event_id, event_type, account_id, payload, payload_sha256, signature_valid, rzp_created_at, status)
VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8)
ON CONFLICT (event_id) DO UPDATE SET duplicate_count = webhook_events.duplicate_count + 1, last_duplicate_at = now()
RETURNING (xmax = 0) AS inserted, duplicate_count;
```
then, only when `inserted` and `eventType ∈ KNOWN_EVENT_TYPES`: `INSERT INTO jobs (kind, payload, dedupe_key) VALUES ('process_event', jsonb_build_object('eventId', $1), 'process_event:' || $1) ON CONFLICT (dedupe_key) DO NOTHING`; unknown type → `UPDATE webhook_events SET status='ignored'`. Comment the `xmax = 0` trick (fresh insert has xmax 0; a conflict-update has a non-zero xmax).
- [x] 3.5 Tests. Unit: valid/invalid/missing header, length mismatch, tampered byte. Integration: (a) valid event → 1 row, 1 job; (b) same event again → `duplicate`, `duplicate_count=1`, still 1 job; (c) `Promise.all` of 20 identical POSTs → 1 row, `duplicate_count=19`, 1 job; (d) bad signature → 401 + row with `signature_valid=false`, 0 jobs; (e) unknown event type → 200 accepted, row `ignored`, 0 jobs; (f) missing `x-razorpay-event-id` → key starts with `sha256:`.
- [x] 3.6 Commit `feat(t03): idempotent razorpay webhook ingress`.

**Verify.** `TestChecklist.md §T3`. **Docs.** `Flow.md` F2 → live; `Bug-Feature.md` F-005.

---

### Task 4: Job worker + entity projections with precedence — **DONE by Codex (2026-09-05) · verified GREEN by Claude (2026-09-05, after fixing B-006)**

**Goal.** Jobs are claimed with `FOR UPDATE SKIP LOCKED`, retried with backoff, dead-lettered; `process_event` projects the Razorpay entity into `payments/orders/subscriptions/invoices/disputes` under a row lock with the precedence rules; the API boots the worker.

**Files.**
- Create: `apps/api/src/worker/job-runner.ts`, `apps/api/src/worker/backoff.ts`, `apps/api/src/worker/sweeper.ts`, `apps/api/src/worker/registry.ts` (kind → handler map)
- Create: `apps/api/src/orchestrator/projections/{payments,orders,subscriptions,invoices,disputes}.ts`, `apps/api/src/orchestrator/projections/index.ts` (`applyProjection(tx, payload): Promise<EntitySnapshot>`), `apps/api/src/orchestrator/entity.ts` (`EntitySnapshot` type)
- Create: `apps/api/src/db/tx.ts` (`withTransaction(pool, fn)` with `BEGIN`/`COMMIT`/`ROLLBACK` and client release), `apps/api/src/db/repos/customers.ts` (`upsertCustomerFromPayload`)
- Modify: `packages/shared/src/domain/precedence.ts` (already has `shouldApplyPaymentTransition`, `isStaleSubscriptionEvent`; add `PAYMENT_STATUS_RANK` export if missing), `apps/api/src/server.ts` (start worker after listen when `AEGIS_WORKER_ENABLED !== 'false'`), `config.ts` (`WORKER_CONCURRENCY` default 4, `WORKER_POLL_MS` default 500)
- Test: `apps/api/src/worker/backoff.test.ts`, `apps/api/test/worker.integration.test.ts`, `apps/api/src/orchestrator/projections/*.test.ts`

**Interfaces.**
- Produces: `startWorker({ pools, logger, handlers, concurrency }): { stop(): Promise<void> }`; `JobHandler = (job: JobRow, ctx: { db, logger, workerId }) => Promise<void>`.
- Produces: `applyProjection(tx, payload) → EntitySnapshot { type, row, customer }`. T8's orchestrator calls this; for T4 register a temporary `process_event` handler that only projects and marks the event `processed`.

**Steps.**
- [x] 4.1 Claim query (exactly):
```sql
UPDATE jobs SET status = 'running', locked_by = $1, locked_at = now(), attempts = attempts + 1, updated_at = now()
WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_at <= now() ORDER BY run_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING *;
```
- [x] 4.2 `backoff(attempts) = min(5000 · 2^(attempts−1), 300000) + random(0..1000)` ms; on error: `attempts < max_attempts ? queued + run_at = now()+backoff : dead_letter`; mirror to `webhook_events.status` (`failed` while retrying, `dead_letter` at the end, `last_error` set). Success → `succeeded`.
- [x] 4.3 Sweeper every 30 s: `UPDATE jobs SET status='queued', locked_by=NULL, locked_at=NULL WHERE status='running' AND locked_at < now() - interval '2 minutes'`.
- [x] 4.4 Projections: each does `SELECT … FROM <table> WHERE id=$1 FOR UPDATE`, applies the precedence rule (payments: `shouldApplyPaymentTransition`; subscriptions/invoices/orders/disputes: `isStaleSubscriptionEvent(last_event_at, rzpCreatedAt)`), upserts with `version = version + 1`, `last_event_id`, and returns the snapshot. Customers are upserted from `payload.*.entity.{customer_id,email,contact,notes.locale}` with `country` derived from the phone prefix (`+91→IN, +1→US, +44→GB, +971→AE, +65→SG`, else `null`) in `packages/shared/src/domain/locale.ts` (`countryFromContact`, `localeFor(country, notesLocale)`).
- [x] 4.5 Tests: 4 loops × 100 jobs → every job succeeded exactly once (`attempts=1`); a handler that throws twice then succeeds → 3 attempts, final `succeeded`; `max_attempts=2` → `dead_letter`; sweeper re-queues a stale `running` row. Projections: `captured` after `authorized` applies; `authorized` after `captured` ignored (version unchanged); `captured` after `failed` ignored; duplicate event no-op; subscription event with older `created_at` ignored.
- [x] 4.6 Commit `feat(t04): job worker with SKIP LOCKED and precedence-guarded projections`.

**Verify.** `TestChecklist.md §T4`. **Docs.** `Flow.md` F1 step 5 + F3 → live; `Bug-Feature.md` F-006.

---

### Task 5: Webhook simulator CLI

**Goal.** `pnpm sim <scenario>` generates Razorpay-shaped, HMAC-signed webhooks (with `x-razorpay-event-id`), can replay duplicates and fire concurrent bursts, and prints a result table. Also exposes `POST /api/v1/sim/run` (dev only) for the dashboard's "Run demo" button.

**Files.**
- Create: `scripts/simulate.ts`, `scripts/sim/scenarios.ts`, `scripts/sim/signer.ts`, `scripts/sim/ids.ts` (`pay_`, `order_`, `sub_`, `inv_`, `disp_`, `evt_` generators with a seedable RNG so runs are reproducible with `--seed`)
- Create: `apps/api/src/routes/sim.ts` (mounted only when `NODE_ENV !== 'production'`; calls the same scenario builders via a shared import from `scripts/sim/scenarios.ts` — move builders into `packages/shared/src/sim/` if importing from scripts is awkward)
- Test: `packages/shared/src/sim/scenarios.test.ts` (every scenario validates against `RazorpayWebhookSchema`)

**Scenarios (exact names).** `payment_failed_3ds_intl` (US Visa, `error_step=payment_authentication`, `error_reason=authentication_failed`, ₹1,499), `payment_failed_cart_dropoff` (`error_reason=payment_cancelled`, `error_source=customer`, domestic UPI), `payment_failed_insufficient_funds`, `payment_failed_intl_not_enabled` (`error_reason=international_transaction_not_allowed`), `payment_captured_after_retry` (same `order_id` as a prior failure → attribution), `subscription_pending`, `subscription_halted`, `subscription_charged` (recovery), `invoice_expired_b2b` (₹4,20,000), `invoice_paid`, `dispute_created` (₹8,999, `reason_code=goods_not_received`, `respond_by=+7d`), `order_paid`, `unknown_event` (`event: "settlement.processed"`), `bad_signature`. `all` runs each once in a sensible order. Flags: `--dupes N` (re-POST the same body+headers N times), `--burst N` (N distinct events concurrently), `--seed S`, `--api URL`, `--chaos llm_down` (sets header `x-aegis-chaos: llm_down`, honoured only in dev by the LLM client, T6).

**Steps.**
- [x] 5.1 Envelope builder `buildWebhook({ event, entityKey, entity, accountId, createdAt })` → `{ entity:'event', account_id, event, contains:[entityKey], payload:{ [entityKey]: { entity } }, created_at }`; sign with `computeSignature` from T3 (import from `@aegis/api`? no — copy the 3-line HMAC into `scripts/sim/signer.ts` and unit-test they match).
- [x] 5.2 Output table: scenario, status code, `status` field, latency; totals accepted/duplicate/rejected/ignored, p50/p95.
- [x] 5.3 Commit `feat(t05): razorpay webhook simulator`.

**Verify.** `TestChecklist.md §T5`. **Docs.** `Flow.md` F11 → live; `Bug-Feature.md` F-007.

---

### Task 6: LLM client abstraction (anthropic / openai / stub) + resilient wrapper + prompt registry

**Goal.** One `LlmClient` interface with JSON-only, zod-validated outputs; adapters for the official Anthropic and OpenAI SDKs; a deterministic stub; a resilience wrapper; a smoke script.

**Files.**
- Create: `apps/api/src/llm/client.ts` (interface + `LlmUnavailableError` + `LlmPurpose`), `anthropic.ts`, `openai.ts`, `stub.ts`, `resilient.ts`, `factory.ts` (`createLlmClient(config, logger)`), `mask.ts` (`maskEmail`, `maskContact`, `maskPii(obj)`), `prompts/index.ts` (registry type: `{ version: string; system: string; buildUser(input): string; schema }`)
- Create: `apps/api/scripts/llm-smoke.ts` (`pnpm --filter @aegis/api llm:smoke`)
- Modify: `config.ts` (`AEGIS_LLM_PROVIDER`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_MODEL_FAST`, `OPENAI_API_KEY`, `OPENAI_API_BASE`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_MODEL_FAST`, `LLM_TIMEOUT_MS` default 20000)
- Test: `apps/api/src/llm/resilient.test.ts`, `stub.test.ts`, `mask.test.ts`, `openai.test.ts` (SDK mocked), `anthropic.test.ts` (SDK mocked)

**Interfaces.** As in `Architecture.md §5` (`LlmJsonRequest`, `LlmJsonResult`, `LlmClient`, `LlmUnavailableError`).

**Steps.**
- [x] 6.1 `anthropic.ts`: `new Anthropic()` (reads `ANTHROPIC_API_KEY` from env); `client.messages.parse({ model, max_tokens: req.maxTokens ?? 2048, system: req.system, messages: [{ role: 'user', content: req.user }], output_config: { format: zodOutputFormat(req.schema) } })` with `import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'`; if `response.stop_reason === 'refusal'` or `parsed_output` is null → throw `LlmUnavailableError('anthropic_unparsable')`; usage from `response.usage.input_tokens/output_tokens`. Catch `Anthropic.RateLimitError`/`APIConnectionError`/`APIError` and rethrow as `LlmUnavailableError` with the class name in the message.
- [x] 6.2 `openai.ts`: `new OpenAI({ apiKey, baseURL: config.OPENAI_BASE_URL ?? config.OPENAI_API_BASE })`; `client.chat.completions.create({ model, messages: [{role:'system', content: system + '\nRespond with a single JSON object only.'}, {role:'user', content: user}], response_format: { type: 'json_object' }, max_completion_tokens })`; if the proxy returns 400 mentioning `response_format`, retry once without it; extract the first `{…}` block from the text; `JSON.parse` → `schema.safeParse`; failure → one repair attempt appending the zod error to the user message; still failing → `LlmUnavailableError('openai_invalid_json')`.
- [x] 6.3 `stub.ts`: deterministic fixtures per purpose in `stub-fixtures.ts`, chosen by simple features of the input (e.g. `diagnose_payment_failure`: if the user text contains `payment_authentication` → `THREE_DS_AUTH_FAILED`/`RETRY_LINK_LOCALIZED`; `payment_cancelled` → `CUSTOMER_ABANDONED_CHECKOUT`/`CART_RECOVERY_NUDGE`; `insufficient_funds` → `INSUFFICIENT_FUNDS`/`RETRY_ALTERNATE_METHOD`; `international_transaction_not_allowed` → `CARD_NOT_ENABLED_INTERNATIONAL`/`RETRY_ALTERNATE_METHOD`; else `UNKNOWN`/`ESCALATE_HUMAN`); `provider='stub'`, `model='fixture-v1'`, latency 5 ms. It must validate against the schema like any provider.
- [x] 6.4 `resilient.ts`: `AbortSignal.timeout(LLM_TIMEOUT_MS)`; retry once on `LlmUnavailableError` whose message contains `RateLimit`, `Connection`, `5xx`, or `timeout`; circuit breaker: 3 consecutive failures → open for 60 s (fail fast with `LlmUnavailableError('circuit_open')`); every call logs `{purpose, provider, model, latencyMs, tokensIn, tokensOut, ok}` at info level; honours `x-aegis-chaos: llm_down` via an `AsyncLocalStorage` chaos flag set by the ingress in dev (throws immediately).
- [x] 6.5 `factory.ts`: `auto` → anthropic if `ANTHROPIC_API_KEY`, else openai if `OPENAI_API_KEY`, else stub; log the choice once at boot; expose `llm.describe()` → `{provider, model, modelFast}` for the dashboard pill (`GET /api/v1/system` returns it, add the route).
- [x] 6.6 Prompt registry conventions: every prompt file exports `{ version: 'v1', system, buildUser, schema }`; the system prompt states the enum values verbatim and forbids prose outside JSON; `input_digest = sha256(system + user)` is stored by callers.
- [x] 6.7 Tests as listed; smoke script prints provider/model and a validated sample for `diagnose_payment_failure`.
- [x] 6.8 Commit `feat(t06): provider-agnostic LLM client with resilience and stub`.

**Verify.** `TestChecklist.md §T6`. **Docs.** `Decisions.md` (only if you deviated), `Flow.md` F4 prerequisites, `Bug-Feature.md` F-008.

**Verified by Claude, 2026-09-05.** GREEN. Full gate green on three consecutive runs (api 18 files / 89 tests). Changed during verification: the duplicated diagnosis contract was single-sourced onto the prompt registry (D-045), `apps/api/test/chaos.integration.test.ts` was added because the `x-aegis-chaos` header and its production gate (C-D5) had no coverage, and the order-dependent T4 subscription-precedence assertion was made deterministic (B-008). B-009 (chaos cannot reach the worker) and B-007 (cold-start projection deadlock) were open at this T6 checkpoint; both were fixed during the T8/T9 run (see `Bug-Feature.md` B-007/B-009).

---

### Task 7: Diagnostician (deterministic hints → LLM → cross-check → fallback)

**Goal.** For `payment.failed` and `subscription.pending|halted`, produce a `Diagnosis` row: root cause + intervention strategy from fixed enums, with confidence, rationale, cross-check overrides and a rule-based fallback.

**Files.**
- Create: `apps/api/src/diagnosis/schema.ts`, `hints.ts`, `cross-check.ts`, `fallback.ts`, `diagnostician.ts`, `apps/api/src/llm/prompts/diagnose-payment-failure.ts`, `diagnose-subscription-failure.ts`, `apps/api/src/db/repos/diagnoses.ts`
- Test: `hints.test.ts`, `cross-check.test.ts`, `fallback.test.ts`, `diagnostician.test.ts` (with stub + a throwing client)

**Interfaces.**
```ts
export const ROOT_CAUSES = ['THREE_DS_AUTH_FAILED','ISSUER_DECLINED','INSUFFICIENT_FUNDS','CARD_NOT_ENABLED_INTERNATIONAL','CUSTOMER_ABANDONED_CHECKOUT','NETWORK_TIMEOUT','RISK_BLOCKED','SUBSCRIPTION_MANDATE_FAILED','UNKNOWN'] as const;
export const STRATEGIES  = ['RETRY_LINK_LOCALIZED','RETRY_ALTERNATE_METHOD','CART_RECOVERY_NUDGE','SUBSCRIPTION_DUNNING','B2B_NEGOTIATE','NO_ACTION','ESCALATE_HUMAN'] as const;
export const DiagnosisSchema = z.object({ root_cause: z.enum(ROOT_CAUSES), confidence: z.number().min(0).max(1), intervention_strategy: z.enum(STRATEGIES), rationale: z.string().min(10).max(600), customer_facing_hint: z.string().max(240).optional() });
export interface Hints { entity: 'payment'|'subscription'; is_international: boolean; method: string|null; error_step: string|null; error_reason: string|null; error_source: string|null; amount_band: 'micro'|'small'|'medium'|'large'; customer_locale: string; prior_failures_24h: number; }
export interface Diagnosis { id: string; rootCause: RootCause; strategy: Strategy; confidence: number; rationale: string; degraded: boolean; degradedReason?: string; crossCheck: { overridden: boolean; notes: string[] }; provider: string; model: string }
export interface Diagnostician { diagnose(input: { event: WebhookEventRow; payload: RazorpayWebhook; entity: EntitySnapshot }): Promise<Diagnosis> }
```
**Steps.**
- [x] 7.1 `hints.ts` (pure): amount bands `<₹500 micro, <₹5,000 small, <₹50,000 medium, else large`; `prior_failures_24h` is passed in by the caller (repo query), default 0.
- [x] 7.2 Cross-check table (implement exactly, each rule appends a note):
  | condition | override |
  |---|---|
  | `error_step='payment_authentication'` and LLM root_cause ∉ {THREE_DS_AUTH_FAILED, NETWORK_TIMEOUT} | root_cause → THREE_DS_AUTH_FAILED |
  | `error_reason='payment_cancelled'` and LLM ≠ CUSTOMER_ABANDONED_CHECKOUT | root_cause → CUSTOMER_ABANDONED_CHECKOUT, strategy → CART_RECOVERY_NUDGE |
  | `error_reason='international_transaction_not_allowed'` | root_cause → CARD_NOT_ENABLED_INTERNATIONAL, strategy → RETRY_ALTERNATE_METHOD |
  | `error_reason='insufficient_funds'` | root_cause → INSUFFICIENT_FUNDS |
  | entity=payment and strategy ∈ {SUBSCRIPTION_DUNNING, B2B_NEGOTIATE} | strategy → ESCALATE_HUMAN |
  | entity=subscription and strategy ∉ {SUBSCRIPTION_DUNNING, NO_ACTION, ESCALATE_HUMAN} | strategy → SUBSCRIPTION_DUNNING |
  | confidence < 0.5 | strategy → ESCALATE_HUMAN |
  | `prior_failures_24h >= 3` | strategy → ESCALATE_HUMAN (stopping rule: do not spam a customer) |
- [x] 7.3 `fallback.ts`: rule-based diagnosis from hints (same mapping as the stub, confidence 0.6, rationale prefixed `rule-based fallback:`), used when `LlmUnavailableError` is thrown; `degraded=true`, `degraded_reason=error.message`.
- [x] 7.4 `diagnostician.ts`: hints → prompt (masked payload, C-A7) → `llm.completeJson` → cross-check → persist (`diagnoses`) → return. Never inside a transaction (C-A6).
- [x] 7.5 Tests for six fixtures (one per scenario from T5) with the stub; with a throwing client → degraded; every cross-check row.
- [x] 7.6 Commit `feat(t07): diagnostician with deterministic hints and cross-checks`.

**Verify.** `TestChecklist.md §T7`. **Docs.** `Flow.md` F4 → live; `Bug-Feature.md` F-009.

**Verified by Claude, 2026-09-05.** GREEN. Full gate green on three consecutive runs (api 23 files / 130 tests). Cross-check table implemented exactly as specified, all eight rows tested. C-A7 re-proved on the real snapshot shape rather than a fixture; C-A6 holds structurally (`db: Pool`) and now has a non-vacuous ordering test; the `numeric(4,3)` confidence cast is load-bearing (the driver really returns `"0.900"`); D-045 honoured — one definition of the contract. Changed during verification: B-010 (`maskPii` flattened every `Date` to `{}`, silently dropping all five timestamps from the prompt — T7 is the first task to mask a database row) and the two tests covering B-010 and C-A6. B-007 and B-009 were still open at this T7 checkpoint; B-007 was fixed by D-048 and B-009 by D-049 during the T8/T9 run.

---

### Task 8: EventOrchestrator + ActionModule contract + actions audit + SSE bus — **DONE by Codex (2026-09-05) · verified GREEN by Claude (2026-09-05; B-007 and B-009 confirmed fixed, no LLM call inside any transaction)**

**Goal.** The brain: route event → project → diagnose (when needed) → run modules through `propose → guard → persist → (execute | pending_approval | blocked)`, with an in-process event bus streamed over SSE. Ship with a `NoopModule` so the pipeline is testable before real modules exist.

**Files.**
- Create: `apps/api/src/orchestrator/types.ts` (exactly `Architecture.md §5`), `routing.ts`, `EventOrchestrator.ts`, `execute.ts` (`executeAction`), `registry.ts` (module list + `AEGIS_MODULES_DISABLED`), `apps/api/src/guardrails/rules.ts` (`killSwitch`, `cooldown`, `quietHours`, `dailyDiscountBudget` — pure functions returning `GuardRule`), `apps/api/src/db/repos/actions.ts`, `outbound-messages.ts`, `ledger.ts`, `audit.ts`, `apps/api/src/bus/event-bus.ts`, `apps/api/src/bus/sse-route.ts`, `apps/api/src/modules/noop/index.ts` (handles nothing, exists for tests)
- Modify: `worker/registry.ts` (`process_event` → orchestrator), `app.ts` (mount `GET /api/v1/stream`, `GET /api/v1/system`), ingress (publish `event.received|duplicate|rejected`)
- Test: `routing.test.ts`, `EventOrchestrator.test.ts` (fake module recording calls), `rules.test.ts`, `apps/api/test/orchestrator.integration.test.ts`, `sse.test.ts`

**Interfaces.** `ROUTES` as in `Flow.md F3`; `EventBus { publish(name: BusEvent, data: unknown): void; subscribe(fn): () => void }`; bus event names: `event.received`, `event.duplicate`, `event.rejected`, `event.processed`, `diagnosis.created`, `action.proposed`, `action.blocked`, `action.pending_approval`, `action.executed`, `action.failed`, `action.rejected`, `message.simulated_sent`, `x402.settled`, `x402.rejected`, `compliance.flag`, `job.dead_letter`.

**Steps.**
- [x] 8.1 Routing table (deterministic, exhaustive for T5 scenarios; unknown → `ignored`).
- [x] 8.2 `handle(eventId, workerId)` exactly as `Flow.md F3` steps 1–7. Status decision: `!guard.pass → blocked`; else `(proposal.requiresApproval || -proposal.moneyImpactPaise > config.auto_approve_limit_paise) → pending_approval`; else `approved` → `executeAction`. Orchestrator-level rules always run: kill switch, per-customer cooldown (`message_cooldown_hours`, from `outbound_messages`), quiet hours (`quiet_hours_local` using the customer's country → timezone map `IN: Asia/Kolkata, US: America/New_York, GB: Europe/London, AE: Asia/Dubai, SG: Asia/Singapore`), daily discount budget (`SUM(-money_impact_paise) today` from `actions WHERE status IN ('approved','executed','pending_approval')`).
- [x] 8.3 `executeAction`: `SELECT … FOR UPDATE` on the action, assert `approved`, call `module.execute`, persist `result`, outbound messages (recipient masked `+91••••••1234`), ledger entries, status `executed|failed`, `executed_at`, audit row, bus publish. Idempotent: an already `executed` action returns early.
- [x] 8.4 SSE route: headers `content-type: text/event-stream`, `cache-control: no-cache`, `x-accel-buffering: no`; heartbeat comment `: ping` every 15 s; unsubscribe on close; CORS for `WEB_ORIGIN`.
- [x] 8.5 Tests: fake module asserts call order and that `guard` is not called when `propose` returns null; kill switch → every proposal `blocked` with rule `kill_switch`; money impact above limit → `pending_approval`; duplicate idempotency_key → second run skips; SSE test with `app.inject` streaming.
- [x] 8.6 Commit `feat(t08): event orchestrator, action audit trail and SSE bus`.

**Verify.** `TestChecklist.md §T8`. **Docs.** `Flow.md` F3, F10 → live; `Bug-Feature.md` F-010; `Architecture.md §13` status row.

---

### Task 9: CheckoutRecovery module (localised WhatsApp retry link) — **DONE by Codex (2026-09-05) · verified GREEN by Claude (2026-09-05)**

**Goal.** For `payment.failed` with strategy `RETRY_LINK_LOCALIZED | RETRY_ALTERNATE_METHOD | CART_RECOVERY_NUDGE`, propose exactly one WhatsApp template message in the customer's locale with a deterministic retry link; guard it; "send" it (persist + log).

**Files.** Create `apps/api/src/modules/checkout-recovery/{index.ts,templates.ts,rules.ts,links.ts,index.test.ts,templates.test.ts}`. Register in `orchestrator/registry.ts`.

**Interfaces.** `templates.ts` exports `TEMPLATES: Record<Locale, { retry_link: TemplateSpec; alt_method: TemplateSpec; cart_nudge: TemplateSpec }>` for locales `en-IN, hi-IN, ta-IN, kn-IN, en-US, en-GB, en-AE, en-SG` (fallback `en-IN`); `TemplateSpec = { name: string; language: string; bodyParams: (p: TemplateParams) => string[]; buttonUrl: (link: string) => string }`. `links.ts`: `retryLink(paymentId, now) = 'https://rzp.io/l/aegis-' + base32(sha256(paymentId + ':' + dayBucket)).slice(0, 8)` (deterministic per payment per day so re-proposals reuse it).

**Steps.**
- [x] 9.1 `canHandle`: event `payment.failed`, `diagnosis` present, strategy ∈ the three, `entity.customer` present.
- [x] 9.2 `propose`: `kind` = `whatsapp_retry_link | whatsapp_alt_method | whatsapp_cart_nudge` (by strategy); `payload` = Meta Cloud API template message: `{ messaging_product:'whatsapp', to:<contact>, type:'template', template:{ name, language:{code}, components:[{type:'body',parameters:[…]},{type:'button',sub_type:'url',index:'0',parameters:[{type:'text',text:<link>}]}] } }`; amount formatted by `formatInr(paise)` in `packages/shared/src/money.ts` (the only place formatting happens for messages); `explanation` = diagnosis rationale + locale reason + link; `expectedRecoveryPaise = amount`; `moneyImpactPaise = 0`; `idempotencyKey = checkout_recovery:payment:<id>:1`; `requiresApproval = false`.
- [x] 9.3 `guard` (pure): `customer.opted_out === false`; `payment.amount_paise > 0`; strategy allowed; (cooldown + quiet hours are orchestrator-level, T8).
- [x] 9.4 `execute`: return `outbound: { channel:'whatsapp', recipientMasked, locale, template, payload, status:'simulated_sent' }`, `result: { link }`. `compensate`: suppressed row.
- [x] 9.5 Tests: locale → template; `hi-IN` body strings are Hindi; opted-out → guard fails with rule `customer_opted_out`; link deterministic within a day; payload validates against a zod `WhatsAppTemplateMessage` schema (add to shared).
- [x] 9.6 Commit `feat(t09): checkout recovery module`.

**Verify/Docs.** `TestChecklist.md §T9–T12` (checkout lines); `Flow.md` F5 bullet → live; `Bug-Feature.md` F-011.

---

### Task 10: SubscriptionSalvager module (dunning state machine) — **UNLOCKED 2026-09-05 (Sprint 2: T10–T16 handed off together in `HANDOFF14.md`)**

**Goal.** On `subscription.pending|halted`, walk a bounded dunning schedule: message + scheduled retry job per step, stop at `max_dunning_retries`, mark `recovered` on `subscription.charged|activated`, `churned` after the last step, `escalated` when the diagnosis says so.

**Files.** Create `apps/api/src/modules/subscription-salvager/{index.ts,state.ts,rules.ts,templates.ts,state.test.ts,index.test.ts}`; add worker handler `dunning_retry` in `worker/registry.ts`; register module.

**Interfaces.** `state.ts`:
```ts
export type SalvageState = 'none'|'retry_scheduled'|'retrying'|'offer_sent'|'recovered'|'churned'|'escalated';
export type SalvageEvent = 'failure_observed'|'retry_due'|'retry_failed'|'payment_succeeded'|'max_retries_reached'|'escalate';
export function nextSalvageState(current: SalvageState, ev: SalvageEvent, retryCount: number, maxRetries: number): SalvageState | null; // null = invalid transition
```
Transition table (implement + comment): `none --failure_observed→ retry_scheduled`; `retry_scheduled --retry_due→ retrying`; `retrying --retry_failed→ (retryCount < max ? retry_scheduled : churned)`; `retry_scheduled|retrying|offer_sent --payment_succeeded→ recovered`; `any --escalate→ escalated`; `recovered|churned|escalated` are terminal (return null for everything except `payment_succeeded` on churned → recovered, which is allowed and logged).

**Steps.**
- [x] 10.1 `propose` on failure: step `n = retry_count + 1`; `runAt = now + dunning_schedule_hours[n-1]`; WhatsApp template `subscription_retry_v1` (locale from customer); `scheduleFollowUp = { kind:'dunning_retry', runAt, payload:{subscriptionId, step:n}, dedupeKey:'dunning_retry:<sub>:<n>' }`; `idempotencyKey = subscription_salvager:subscription:<id>:<n>`; `expectedRecoveryPaise = amount`.
- [x] 10.2 `guard`: `retry_count < max_dunning_retries` (rule `max_dunning_retries`), `status ∈ {pending, halted}`, not opted out, transition valid.
- [x] 10.3 `execute`: transition to `retry_scheduled` (update `subscriptions.salvage_state, retry_count, next_retry_at`), outbound message, enqueue follow-up.
- [x] 10.4 `dunning_retry` handler: transition `retrying`; simulate the retry outcome deterministically from `subscriptions.notes.sim_retry_outcomes[step]` (seeded/simulator-controlled), else `retry_failed`; on failure propose the next step through the orchestrator path (call `orchestrator.handleSynthetic({ kind:'dunning_step', subscriptionId })` — add this small entry point) or churn.
- [x] 10.5 On `subscription.charged|activated` (routed in T8's table): if `salvage_state` non-terminal → `recovered`, cancel pending `dunning_retry` jobs (`status='cancelled'` by dedupe_key prefix), ledger `recovered_revenue` credit = amount, action row `kind='salvage_recovered'` (money impact 0), bus publish.
- [x] 10.6 Tests: exhaustive transition table; max retries → churned; recovered cancels jobs; idempotent re-run of the same step.
- [x] 10.7 Commit `feat(t10): subscription salvager dunning state machine`.

**Verify/Docs.** `TestChecklist.md §T9–T12`; `Flow.md` F5; `Bug-Feature.md` F-012.

---

### Task 11: B2BNegotiator module (bounded discount negotiation)

**Goal.** On `invoice.expired` for invoices ≥ ₹50,000, run a bounded negotiation: offers computed by code from a floor and a max-discount ceiling, LLM drafts the wording only, approvals gate large discounts, hard stop after N rounds.

**Files.** Create `apps/api/src/modules/b2b-negotiator/{index.ts,pricing.ts,state.ts,rules.ts,pricing.test.ts,state.test.ts,index.test.ts}`, `apps/api/src/llm/prompts/draft-negotiation-message.ts`; worker handler `negotiation_expiry`; route `invoice.updated` (counter-offers) in T8's table.

**Interfaces.** `pricing.ts`:
```ts
export const ROUND_DISCOUNT_PCT = [5, 10, 15] as const;
// Intent: the offer for round n is the invoice amount less the round's discount, never below the floor and never beyond max_discount_pct.
export function offerForRound(amountPaise: number, floorPaise: number, round: 1|2|3, maxDiscountPct: number): { offerPaise: number; discountPct: number; clampedBy: 'none'|'floor'|'max_pct' };
export function isAcceptableCounter(counterPaise: number, floorPaise: number): boolean;
```
All arithmetic in integer paise with `Math.ceil` toward the merchant; unit tests cover clamping. `state.ts`: `nextNegotiationState(current, ev: 'expired_invoice'|'offer_sent'|'counter_received'|'accepted'|'rejected'|'timeout'|'max_rounds', round, maxRounds)`.

**Steps.**
- [x] 11.1 `canHandle`: `invoice.expired`, `amount_paise >= 5_000_000`, `negotiation_state ∈ {none, countered}`.
- [x] 11.2 `propose`: round `r = negotiation_round + 1`; `{offerPaise, discountPct}` from `offerForRound`; LLM `draft_negotiation_message` with **masked** customer + line items + placeholders `{{OFFER_AMOUNT}}`, `{{VALID_UNTIL}}` (schema: `{ subject: string.max(120), body: string.max(1200) }`; body must contain both placeholders — zod `.refine`); code substitutes the numbers; fallback (LLM down) = static template; `payload` = WhatsApp text message `{ messaging_product:'whatsapp', to, type:'text', text:{ body } }` + `email` mirror; `moneyImpactPaise = -(amount - offer)`; `expectedRecoveryPaise = offer`; `requiresApproval = discountPct >= 10`; `idempotencyKey = b2b_negotiator:invoice:<id>:<r>`; `scheduleFollowUp = negotiation_expiry` at +72 h.
- [x] 11.3 `guard`: `offer >= floor` (rule `floor_amount`), `discountPct <= max_discount_pct` (rule `max_discount_pct`), `r <= max_negotiation_rounds` (rule `max_negotiation_rounds`), daily budget (orchestrator), `counter >= floor` when responding to a counter.
- [x] 11.4 `execute`: `negotiation_state='offer_sent'`, `negotiation_round=r`, `current_offer_paise`, outbound message(s), follow-up job. On `invoice.paid` with `amount_paid >= current_offer` → `accepted`, ledger `discount_granted` debit = amount − paid, `recovered_revenue` credit = paid, action `negotiation_accepted`. On `invoice.updated` with `notes.counter_paise`: if acceptable → state `countered` → next round via orchestrator; if below floor → `rejected` + `ESCALATE_HUMAN` action `pending_approval` (a human may override the floor — recorded).
- [x] 11.5 `negotiation_expiry` handler: `offer_sent` older than 72 h → `expired`; if `round < max` → propose next round, else `escalated`.
- [x] 11.6 Tests: pricing clamps (floor, max pct), round 4 → `escalated`, discount ≥ 10 % → `pending_approval`, LLM-down → static template still bounded, counter below floor → rejected+escalated.
- [x] 11.7 Commit `feat(t11): bounded b2b negotiator`.

**Verify/Docs.** `TestChecklist.md §T9–T12`; `Flow.md` F5; `Bug-Feature.md` F-013.

---

### Task 12: ChargebackEvidence module (evidence packet → human review)

**Goal.** On `payment.dispute.created`, assemble a structured evidence packet from the DB, have the LLM write a narrative, and pause at `requires_human_review`. Nothing is ever auto-submitted.

**Files.** Create `apps/api/src/modules/chargeback-evidence/{index.ts,assemble.ts,packet-schema.ts,index.test.ts,assemble.test.ts}`, `apps/api/src/llm/prompts/draft-evidence-narrative.ts`, `apps/api/src/db/repos/evidence.ts`.

**Interfaces.** `packet-schema.ts` zod `EvidencePacket`: `{ dispute: {id, amount_paise, reason_code, reason_description, phase, respond_by}, payment: {id, amount_paise, method, card_network, card_last4?, captured_at, international}, order: {id, items[], amount_paise, receipt}, customer: {id_masked, country, locale, account_age_days}, delivery: {carrier?, tracking?, delivered_at?, proof_url?} | null, communications: {channel, template, sent_at}[], refund_policy: {url, summary}, prior_disputes: number, missing: string[] }` — `missing` lists every section that could not be filled (honest exception list).

**Steps.**
- [ ] 12.1 `assemble(db, disputeId)` (deterministic): joins `disputes → payments → orders → customers`, `outbound_messages` for the customer, delivery proof from `orders.notes.delivery`, prior disputes count; fills `missing`.
- [ ] 12.2 `propose`: `kind='evidence_packet'`, `payload = packet`, `requiresApproval = true` always, `moneyImpactPaise = 0`, `expectedRecoveryPaise = dispute.amount_paise`, `idempotencyKey = chargeback_evidence:dispute:<id>:1`. LLM narrative (`draft_evidence_narrative`, schema `{ narrative: string.max(2000), confidence_note: string.max(300) }`) with masked packet; fallback = templated narrative listing sections present/missing.
- [ ] 12.3 `execute` (called only after human approval): mark `evidence_packets.review_status='submitted'` (simulated), `disputes.status='under_review'`, ledger `chargeback_exposure` credit (exposure covered) — comment that real submission would call Razorpay's dispute API.
- [ ] 12.4 On proposal persistence (T8 flow) also insert `evidence_packets` with `requires_human_review` — do this in `propose` via a repo call? No: `propose` must not write. Add `onProposed?(action, ctx, db)` optional hook to `ActionModule` (update `types.ts` + `Architecture.md §5`) that the orchestrator calls after the action row is inserted; use it here to insert the packet.
- [ ] 12.5 Tests: packet has all sections for the seeded dispute, `missing` lists `delivery` when absent; `requires_human_review` set; `execute` refuses if `review_status !== 'approved'`.
- [ ] 12.6 Commit `feat(t12): chargeback evidence assembler with human review`.

**Verify/Docs.** `TestChecklist.md §T9–T12`; `Flow.md` F5, F6; `Architecture.md §5` hook; `Bug-Feature.md` F-014.

---

### Task 13: Approvals API + ledger attribution + metrics summary

**Goal.** Humans approve/reject actions and evidence; recovered money is attributed deterministically; a single metrics endpoint powers the Overview.

**Files.** Create `apps/api/src/routes/api/{approvals.ts,actions.ts,evidence.ts,metrics.ts,events.ts,entities.ts,guardrails.ts}`, `apps/api/src/orchestrator/attribution.ts`, `apps/api/src/db/repos/metrics.ts`; tests `apps/api/test/approvals.integration.test.ts`, `attribution.test.ts`.

**Endpoints (exact).**
- `GET /api/v1/events?type&status&limit=50&before=<iso>` → `{ items: WebhookEventSummary[], next }`; `GET /api/v1/events/:eventId` → full row + diagnoses + actions.
- `GET /api/v1/actions?status&module&limit&before`; `GET /api/v1/actions/:id` → action + diagnosis + outbound_messages + ledger_entries + audit.
- `POST /api/v1/actions/:id/decision` body `{ decision:'approve'|'reject', note: string.min(3), actor: string }` → transaction: `FOR UPDATE`, assert `pending_approval`, `approved` → `executeAction` → `{ action }`; `rejected` → `{ action }`; audit row; 409 if not pending.
- `GET /api/v1/approvals` → `{ actions: [...pending_approval], evidence: [...requires_human_review with packet] }`.
- `GET /api/v1/evidence/:disputeId`; `POST /api/v1/evidence/:disputeId/decision` same body → approve → `review_status='approved'` then `executeAction` on the linked action; reject → `rejected`.
- `GET /api/v1/subscriptions`, `GET /api/v1/invoices`, `GET /api/v1/disputes` (list views).
- `GET /api/v1/guardrails` → rows; `PUT /api/v1/guardrails/:key` body `{ value, actor }` → validate per key (zod map), update, audit; kill switch changes publish `system.kill_switch`.
- `GET /api/v1/metrics/summary` → `{ events: { received, duplicates, rejected, processed, dead_letter }, actions: { proposed, blocked, pending_approval, executed, rejected }, money: { recovered_paise, discounts_granted_paise, x402_revenue_paise, chargeback_exposure_paise }, humans: { reviewed, approved, rejected, rejection_rate }, llm: { calls, degraded, degraded_rate, avg_latency_ms, by_provider }, window: '24h'|'7d'|'all' }` (query `?window=`).

**Steps.**
- [ ] 13.1 Attribution: on `payment.captured` / `order.paid` route, `attribution.ts` looks for an `executed` action for the same `order_id` or `customer_id` within `attribution_window_hours`; if found: ledger `recovered_revenue` credit = amount with `ref_type='action'`, action `result.recovered_paise`, bus `action.recovered`. Never double-attribute (`ledger_entries` unique index on `(account, ref_type, ref_id)` — add migration `0003_ledger_unique.sql`).
- [ ] 13.2 Implement routes with zod body schemas and consistent error shape `{ error: string, details? }`.
- [ ] 13.3 Tests: approve executes exactly once under concurrent double-click (two parallel decisions → one 200, one 409); reject never executes; metrics numbers reconcile with direct SQL in the test.
- [ ] 13.4 Commit `feat(t13): approvals, attribution ledger and metrics`.

**Verify/Docs.** `TestChecklist.md §T13`; `Flow.md` F6 → live; `Bug-Feature.md` F-015.

---

### Task 14: x402-native API gateway (simulated facilitator)

**Goal.** Paid endpoints for AI buyers: `402` challenge without `X-PAYMENT`, HMAC-verified simulated payment with server-issued nonce, replay protection, per-request and per-payer caps, ledger entry, kill switch; plus a buyer CLI for the demo.

**Files.** Create `apps/api/src/x402/{types.ts,middleware.ts,facilitator.ts,routes.ts,canonical.ts,routes.test.ts,facilitator.test.ts}`, `apps/api/src/db/repos/x402.ts`, `scripts/x402-buy.ts` (`pnpm x402:buy <productId> [--replay] [--amount N] [--payer id]`), migration `0004_x402_indexes.sql` if needed; config `X402_SIM_SECRET`, `X402_PAY_TO`.

**Wire shapes (exact).**
- 402 body: `{ "x402Version": 1, "error": "X-PAYMENT header is required", "accepts": [{ "scheme": "exact", "network": "aegis-sim", "maxAmountRequired": "<paise>", "resource": "<absolute url>", "description": "<product name>", "mimeType": "application/json", "payTo": "<X402_PAY_TO>", "maxTimeoutSeconds": 60, "asset": "INR", "extra": { "nonce": "<uuid>", "expiresAt": "<iso>", "simulated": true } }] }`.
- `X-PAYMENT` header = base64(JSON): `{ "x402Version": 1, "scheme": "exact", "network": "aegis-sim", "payload": { "nonce", "amount": "<paise>", "asset": "INR", "payTo", "payer": "agent:<id>", "issuedAt": "<iso>", "signature": "<hex>" } }` where `signature = HMAC-SHA256(X402_SIM_SECRET, canonical)` and `canonical = [nonce, amount, asset, payTo, payer, issuedAt].join('|')` (`canonical.ts`, unit-tested).
- Success: `200` resource JSON + header `X-PAYMENT-RESPONSE` = base64 `{ "success": true, "txId": "<uuid>", "network": "aegis-sim", "settledAt": "<iso>" }`.
- Rejections: `402 { "x402Version":1, "error": "<reason>" }` with reasons `invalid_payment_header | unknown_nonce | nonce_expired | nonce_already_settled | amount_below_required | bad_signature | amount_exceeds_policy | payer_daily_cap_exceeded`; kill switch → `503 { "error": "gateway_paused" }`.

**Steps.**
- [ ] 14.1 `x402Middleware(priceFor: (req) => Promise<{ amountPaise, description }>)` as a Fastify `preHandler`: no header → insert `challenged` row (expires +60 s) → 402. Header → decode → `facilitator.verifyAndSettle(payload, required)` in one transaction: `SELECT … FOR UPDATE` by nonce; check status `challenged`, not expired, amount ≥ required, signature, `amount <= x402_max_amount_paise`, payer daily sum + amount ≤ `x402_daily_cap_per_payer_paise`, kill switch off → `settled` + ledger `x402_revenue` credit + audit + bus `x402.settled`; any failure → `rejected` with reason + bus `x402.rejected`.
- [ ] 14.2 Routes: `GET /x402/catalog` (free), `GET /x402/products/:id/spec` (paid = product price), `POST /x402/orders {product_id, qty ≤ 5}` (paid = price × qty; creates an `orders` row with `notes.channel='x402'`), `GET /api/v1/x402/payments` (list for the lab page).
- [ ] 14.3 Buyer CLI: step 1 request → print 402 JSON; step 2 build + sign header → print 200 + decoded `X-PAYMENT-RESPONSE`; `--replay` reuses the nonce → print the rejection; `--amount` overrides to demonstrate caps.
- [ ] 14.4 Tests: happy path; replay → `nonce_already_settled`; expired nonce; tampered amount → `bad_signature`; over cap; two concurrent settlements of one nonce → exactly one settled (row lock); kill switch → 503.
- [ ] 14.5 Commit `feat(t14): x402 gateway with simulated facilitator`.

**Verify/Docs.** `TestChecklist.md §T14`; `Flow.md` F7 → live; `Bug-Feature.md` F-016; `Decisions.md` D-024 confirmed.

---

### Task 15: Ask Aegis — Text-to-SQL sandbox + deterministic forecaster

**Goal.** Natural-language questions over the local DB: LLM writes SQL, code validates it (AST), the read-only role executes it with a timeout and row limit, the SQL is always shown; forecast questions produce numbers computed in TypeScript.

**Files.** Create `apps/api/src/nlq/{schema-doc.ts,validator.ts,service.ts,metrics.ts,forecast.ts,intent.ts,validator.test.ts,forecast.test.ts,intent.test.ts}`, prompts `text-to-sql.ts`, `summarize-query-result.ts`, `nl-to-forecast-spec.ts`, routes `POST /api/v1/ask`, `GET /api/v1/ask/history`; add dependency `pgsql-ast-parser` (record in `Decisions.md`).

**Steps.**
- [ ] 15.1 `schema-doc.ts`: hand-written description of every table the readonly role can read, with column meanings and the PII columns **omitted**, plus 6 example question→SQL pairs (few-shot). Keep under 2,500 tokens.
- [ ] 15.2 `validator.ts` with `pgsql-ast-parser`: exactly one statement; type `select` (CTEs allowed if all `select`); every table ref ∈ allowlist (the tables in schema-doc); no schema-qualified refs to `pg_catalog`/`information_schema`; no function ∈ denylist `[pg_sleep, pg_read_file, pg_read_binary_file, pg_ls_dir, lo_import, lo_export, dblink, copy, set_config, current_setting, pg_terminate_backend, pg_cancel_backend]`; no `INTO`; then wrap `SELECT * FROM (<sql>) AS q LIMIT 200`. Return `{ ok: true, sql } | { ok: false, errors: string[] }`.
- [ ] 15.3 `service.ts` as in `Flow.md F8`: intent (regex) → query or forecast; execute on the readonly pool inside a transaction: `SET LOCAL statement_timeout = '5000ms'` then the wrapped SQL; summarise via LLM (fallback: `"<n> rows; first row: …"`); persist `nl_queries`.
- [ ] 15.4 `metrics.ts` deterministic daily series SQL for `gmv`, `failed_payments`, `recovered_revenue`, `disputes`, `x402_revenue` (window days param). `forecast.ts`: `forecast(series: {date, value}[], horizonDays)` → OLS slope/intercept over the window + 7-day moving average baseline → `{ points: {date, value, lower, upper}[], method: 'ols+ma7', slopePerDay, r2 }` with `lower/upper = value ± 1.0·stddev(residuals)`; pure, unit tested against a hand-computed fixture.
- [ ] 15.5 Tests: validator rejects `UPDATE`, `DELETE`, `;` chains, `pg_sleep(1)`, `information_schema.tables`, `customers.email` reference (allowed by parser but the DB will reject — return the DB error verbatim, executed=false); accepts joins and CTEs; forecast math fixture.
- [ ] 15.6 Commit `feat(t15): text-to-sql sandbox and deterministic forecaster`.

**Verify/Docs.** `TestChecklist.md §T15`; `Flow.md` F8 → live; `Bug-Feature.md` F-017; `Decisions.md` (`pgsql-ast-parser`).

---

### Task 16: Compliance scanner (keyword pre-screen + LLM rubric + evidence verification)

**Goal.** A background job scans product descriptions against a fixed rubric of prohibited/restricted categories; deterministic keywords run first; the LLM classifies with a verbatim evidence span that code verifies; flags land on the dashboard.

**Files.** Create `apps/api/src/compliance/{keywords.ts,rubric.ts,scanner.ts,verify.ts,keywords.test.ts,verify.test.ts,scanner.test.ts}`, prompt `classify-compliance.ts`, routes `POST /api/v1/compliance/scan`, `GET /api/v1/compliance/flags?status&risk`, `POST /api/v1/compliance/flags/:id/status {status, actor}`; worker handler `compliance_scan`; optional periodic enqueue every 6 h when `AEGIS_COMPLIANCE_CRON=true`.

**Rubric categories (exact).** `adult_content, gambling_lottery, drugs_paraphernalia, weapons, tobacco_vape, counterfeit_ip, financial_guarantees_mlm, medical_claims_unapproved, crypto_forex_unlicensed, hate_or_illegal, none`. Schema: `{ risk_level: enum(none|low|medium|high|prohibited), category: enum(above), evidence_span: string.max(200), recommendation: string.max(300), reasoning: string.max(400) }`.

**Steps.**
- [ ] 16.1 `keywords.ts`: per category, 6–12 lowercase patterns (e.g. `guaranteed returns`, `monthly returns`, `cures`, `replica`, `first copy`, `vape`, `nicotine`, `lottery`, `betting`). `prescreen(description) → { category, pattern }[]`.
- [ ] 16.2 `scanner.run(runId)`: for each active product → prescreen → LLM (`tier: 'fast'`) with the description only (no PII) → `verifyEvidenceSpan` (`description.includes(evidence_span)` case-sensitive; else `status='needs_review'`, note) → agreement: if keywords hit a category and the LLM says `none` → `needs_review`; upsert one flag per product per run; update run counters; degraded (LLM down) → flag from keywords only with `risk_level='medium'`, `llm_assessment=null`, `degraded_count++`.
- [ ] 16.3 Tests: seeded risky products produce ≥ 5 flags with the expected categories using the stub; a fabricated span → `needs_review`; LLM-down path.
- [ ] 16.4 Commit `feat(t16): compliance scanner`.

**Verify/Docs.** `TestChecklist.md §T16`; `Flow.md` F9 → live; `Bug-Feature.md` F-018.

---

### Task 17: Web shell — design system, navigation, theme, footer, API client, SSE hook, GlowInput

**Goal.** The dashboard skeleton every page task builds on. Read `Design.md` §1–3, 5.3, 7, 8 first.

**Files.** In `apps/web/src`: `app/globals.css` (Tailwind 4 `@theme` tokens from `Design.md §2`, light + `.dark`), `app/layout.tsx` (fonts via `next/font` Geist Sans/Mono, `ThemeProvider`, `AppShell`, footer — keep the existing footer text), `components/shell/{AppShell,Sidebar,TopBar,ThemeToggle,EnvPill,LlmPill,KillSwitchPill}.tsx`, `components/ui/{Card,Badge,Button,Table,Drawer,Toast,KpiTile,JsonView,GlowInput,EmptyState,Skeleton}.tsx`, `lib/api.ts` (typed fetch wrapper around `NEXT_PUBLIC_API_URL`, error shape), `lib/sse.ts` (`useEventStream(names[]) → { events, status }` with reconnect/backoff), `lib/format.ts` (`formatInr(paise)`, `relativeTime`, `maskId`), `lib/types.ts` (import from `@aegis/shared`).

**Steps.**
- [ ] 17.1 Tokens + typography + dark/light verified with the toggle; `color-scheme` meta switches.
- [ ] 17.2 Shell responsive breakpoints: sidebar 240px ≥ 1024, icon rail ≥ 640, bottom bar < 640. Active route highlight. Footer at the bottom of the scroll container on every route (`app/layout.tsx`).
- [ ] 17.3 `TopBar` pills read `GET /api/v1/system` (provider/model, env) and `GET /api/v1/guardrails` (kill switch) and subscribe to `system.kill_switch`.
- [ ] 17.4 `GlowInput` exactly per `Design.md §5.3` (conic gradient halo with animated `--a`, focus intensifies, `Tab` fills the example, Enter submits, loading state).
- [ ] 17.5 `useEventStream`: `EventSource` to `/api/v1/stream`, parse `event:` names, keep last 200, reconnect with backoff 1→10 s, expose `status: 'connecting'|'live'|'reconnecting'`.
- [ ] 17.6 Placeholder routes for every page in `Design.md §4` rendering `EmptyState` (so navigation works end-to-end); a `/kitchen-sink` dev route showing every UI component in both themes (excluded from nav).
- [ ] 17.7 `pnpm --filter @aegis/web build` green; ESLint green.
- [ ] 17.8 Commit `feat(t17): web shell and design system`.

**Verify/Docs.** `TestChecklist.md §T17–T22`; `Bug-Feature.md` F-019; `Design.md` (record any token changes).

---

### Task 18: Overview + Events pages

**Files.** `app/page.tsx` (Overview), `app/events/page.tsx`, `components/overview/{KpiGrid,RecentActions,MoneyStrip,LlmHealth}.tsx`, `components/events/{EventFeed,EventRow,EventDrawer,EventFilters}.tsx`, `components/fx/HalftoneField.tsx` (per `Design.md §5.2` — build it now since Events needs it; the prism comes in T22, use a static `PrismPlaceholder` on the Overview until then).

**Steps.**
- [ ] 18.1 Overview: KPI tiles from `GET /api/v1/metrics/summary?window=24h` with window switcher; live increments via SSE (`event.received`, `action.executed`, `x402.settled`); "Run demo" button → `POST /api/v1/sim/run {scenario:'all'}` (dev only) with progress toast; recent actions list linking to `/actions/:id`.
- [ ] 18.2 Events: server-rendered first page from `GET /api/v1/events`, SSE prepends new rows with the module-colour rail flash; columns: time, event id (mono, copy), type badge, signature ✓/✗, dup count (highlight > 0), status, latency; filters by type/status; drawer with raw JSON (`JsonView`), diagnoses and actions for the event; `HalftoneField` backdrop whose `intensity` pulses on new events; `aria-live="polite"`.
- [ ] 18.3 Empty states are real (no fake rows). Mobile: card layout under 640px.
- [ ] 18.4 Commit `feat(t18): overview and live events pages`.

**Verify/Docs.** Chrome check by the Architect; `Bug-Feature.md` F-020.

---

### Task 19: Actions audit trail + Approvals pages

**Files.** `app/actions/page.tsx`, `app/actions/[id]/page.tsx`, `app/approvals/page.tsx`, `components/actions/{ActionTable,ActionDrawer,BoundsChecklist,DiagnosisCard,OutboundPayload,Timeline,ModuleBadge}.tsx`, `components/approvals/{ApprovalQueue,ApprovalCard,EvidencePacketView,DecisionForm}.tsx`.

**Steps.**
- [ ] 19.1 Actions list with filters (status, module), status pills coloured per `Design.md`, money impact and expected recovery in ₹ (`formatInr`), degraded badge when the diagnosis was rule-based.
- [ ] 19.2 Action detail: `BoundsChecklist` renders every `GuardRule` (✓/✗, rule, limit vs actual, note); `DiagnosisCard` (root cause, confidence bar, strategy, rationale, cross-check notes, provider/model); `OutboundPayload` shows the exact JSON with copy + "simulated" watermark; `Timeline` from `audit_log` + timestamps.
- [ ] 19.3 Approvals: two queues (actions, evidence). `EvidencePacketView` shows each packet section, the `missing` list prominently, and the AI narrative in a clearly labelled "AI-drafted" box; `DecisionForm` requires a note, posts the decision, optimistic update, toast, and disables double-submit (server returns 409 on races — show it).
- [ ] 19.4 Commit `feat(t19): actions audit trail and approvals`.

**Verify/Docs.** `Bug-Feature.md` F-021.

---

### Task 20: Ask Aegis + Compliance pages

**Files.** `app/ask/page.tsx`, `components/ask/{AskComposer,AnswerCard,SqlBlock,ResultTable,ForecastChart,History}.tsx`, `app/compliance/page.tsx`, `components/compliance/{FlagList,FlagCard,EvidenceHighlight,RiskBadge,ScanButton}.tsx`. Charts: a small hand-rolled SVG line chart (no chart library; record in `Decisions.md` if you add one).

**Steps.**
- [ ] 20.1 Ask: `GlowInput` composer with 4 suggested questions (chips); answer card shows: intent, generated SQL (`SqlBlock` with light syntax colouring, always visible even on validation failure), validation verdict (✓ or the error list), `ResultTable` (sticky header, horizontal scroll inside the card), NL summary (labelled AI), latency/provider footer; forecast questions render `ForecastChart` (history line, forecast line, shaded band, method label `ols+ma7`) with numbers in a table below for accessibility. History from `GET /api/v1/ask/history`.
- [ ] 20.2 Compliance: flags grouped by `risk_level` (prohibited → none), `EvidenceHighlight` wraps the evidence span in the description with `<mark>`, keyword vs LLM agreement badge, `needs_review` and degraded badges, actions acknowledge / resolve / false positive (`POST …/status`), "Run scan" button with run progress via SSE `compliance.flag`.
- [ ] 20.3 Commit `feat(t20): ask aegis and compliance pages`.

**Verify/Docs.** `Bug-Feature.md` F-022.

---

### Task 21: x402 Lab + Settings + entity views

**Files.** `app/x402/page.tsx`, `components/x402/{Stepper,ChallengeView,PaymentView,ReplayView,SettlementTable,CapsPanel}.tsx`, `app/settings/page.tsx`, `components/settings/{GuardrailForm,KillSwitch,ChangeHistory}.tsx`, `app/subscriptions/page.tsx`, `app/invoices/page.tsx` (simple tables with state badges; linked from Actions).

**Steps.**
- [ ] 21.1 x402 Lab: three-step stepper that calls the API from the browser (`GET /x402/products/:id/spec` without header → show 402 JSON; the page builds the `X-PAYMENT` header by calling a dev-only helper `POST /api/v1/sim/x402-sign` that signs with the server secret — never ship the secret to the browser — then shows the 200 + decoded `X-PAYMENT-RESPONSE`; replay → rejection). `SettlementTable` from `GET /api/v1/x402/payments` + SSE. `CapsPanel` shows the caps and today's usage.
- [ ] 21.2 Settings: form over `GET/PUT /api/v1/guardrails` with per-key validation messages, kill switch as a large toggle with a confirm dialog (custom component, never `window.confirm`), change history from `audit_log`.
- [ ] 21.3 Commit `feat(t21): x402 lab, settings and entity views`.

**Verify/Docs.** `Bug-Feature.md` F-023.

---

### Task 22: Flourishes — PrismHero (vgpu + Canvas 2D), polish, responsiveness, accessibility

**Files.** `components/prism/{prismGeometry.ts,prismGeometry.test.ts,PrismWebGPU.tsx,prism.wgsl,PrismCanvas2D.tsx,PrismHero.tsx}`; add deps in `apps/web` only: `vgpu`, `three`, `@webgpu/types` (record in `Decisions.md` with versions); `next.config.ts` (WGSL import handling per vgpu docs); polish pass over all pages.

**Steps.**
- [ ] 22.1 `prismGeometry` per `Design.md §5.1` (pure, tested: beam angle follows pointer; fan spans 18°; rest angle when pointer null).
- [ ] 22.2 `PrismWebGPU` via `vgpu` `effect()` — before writing WGSL run `npx vgpu docs cat getting-started.md` and `npx vgpu examples search "fullscreen"`; uniforms `time, pointer, resolution, activity[7]`; module activity pulses from SSE.
- [ ] 22.3 `PrismCanvas2D` with identical props; `PrismHero` feature-detects `navigator.gpu` and `prefers-reduced-motion`; DPR cap 2; pauses when hidden; `NEXT_PUBLIC_PRISM_MODE=auto|2d|gpu`.
- [ ] 22.4 Polish: consistent spacing, focus rings, table density, skeletons, toasts; run Lighthouse (a11y ≥ 90, no horizontal scroll at 360px), fix findings.
- [ ] 22.5 Commit `feat(t22): prism hero and ui polish`.

**Verify/Docs.** Chrome check by the Architect (both prism paths); `Bug-Feature.md` F-024; `Design.md` status.

---

### Task 23: Demo storyboard, README, video plan

**Files.** `scripts/demo.sh` (or `demo.ts`), `README.md` (rewrite), `docs/video-storyboard.md`, `docs/architecture.svg` (export of the system map — hand-drawn SVG is fine).

**Steps.**
- [ ] 23.1 `pnpm demo`: resets demo data (`db:seed`), starts nothing (assumes API+web running), then runs in order with short pauses and printed narration: `sim payment_failed_3ds_intl --dupes 3` → `sim payment_failed_cart_dropoff` → `sim subscription_halted` → `sim invoice_expired_b2b` → `sim dispute_created` → `x402:buy prod_001` → `x402:buy prod_001 --replay` → `sim payment_captured_after_retry` (attribution) → compliance scan → prints `GET /api/v1/metrics/summary`; then `AEGIS_CHAOS=llm_down sim payment_failed_3ds_intl` to show graceful degradation. Under 3 minutes.
- [ ] 23.2 README: what/why, architecture diagram, 5-command quickstart (`bootstrap-system.sh` → `setup.sh` → `pnpm dev` → `pnpm demo` → open :3000), the AI boundary table, honest metrics section (including false positives: human rejection rate, degraded rate), "what broke at 2 AM" pulled from `Bug-Feature.md`, track mapping, what is simulated.
- [ ] 23.3 Video storyboard: 5 minutes, shot list with timestamps matching `pnpm demo`.
- [ ] 23.4 Commit `docs(t23): demo storyboard and readme`.

**Verify/Docs.** `TestChecklist.md §T23–T24`; `Bug-Feature.md` F-025.

---

### Task 24: Hardening — security review, failure drills, final test pass

**Steps.**
- [ ] 24.1 Security pass against `Constraints.md §D`: grep for secrets, verify pino redaction, verify readonly grants, verify dev routes are not mounted in production (`NODE_ENV=production pnpm --filter @aegis/api start` → `POST /api/v1/sim/run` is 404), rate limits respond 429.
- [ ] 24.2 Failure drills (record each in `Bug-Feature.md` 2 AM log with real output): LLM down (`AEGIS_CHAOS=llm_down`), Postgres restarted mid-run (`sudo systemctl restart postgresql` by the human) → API `/health` degraded then ok, worker resumes, no lost jobs; duplicate storm (`sim burst --n 200 --dupes 5`) → counts reconcile; kill switch flipped during the demo → actions blocked within one poll.
- [ ] 24.3 `pnpm test && pnpm typecheck && pnpm lint && pnpm --filter @aegis/web build` green; tag `v1.0.0`.
- [ ] 24.4 Commit `chore(t24): hardening and release`.

**Verify/Docs.** `TestChecklist.md §T23–T24`; `Bug-Feature.md` F-026; `Rollback.md` verified levels L0–L5 actually work (note evidence).
