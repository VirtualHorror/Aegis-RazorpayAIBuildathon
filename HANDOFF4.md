# Handoff 4 — Task 4: job worker + precedence-guarded entity projections

**Generated**: 2026-09-05 06:09 UTC
**Branch**: `main` (clean apart from this untracked file)
**Status**: Task 3 verified GREEN — Task 4 is unlocked and unstarted
**Baseline tag**: `task-03-done` → `a7e9155`. Your diff for review is `git diff task-03-done..HEAD`.

## Goal

Implement `Checklist.md` **Task 4** only: claim jobs with `FOR UPDATE SKIP LOCKED`, retry with backoff, dead-letter, sweep stale locks, and project the Razorpay entity from each `process_event` job into `payments/orders/subscriptions/invoices/disputes` under a row lock with the precedence rules. Read `AGENTS.md` first; `Constraints.md` is binding; do not start Task 5.

## Completed (Task 3, by the Verification Agent — context, not your work)

- [x] T3 verified GREEN. `Checklist.md` T3 heading, `Architecture.md` status table, `Bug-Feature.md` F-005 all say `verified`.
- [x] **B-004 fixed** — one critical vulnerability found in T3 and repaired in `a7e9155`. Read "Failed Approaches" below; the same class of mistake is available to you in T4.
- [x] `C-C1` tightened, `D-031` added, `TestChecklist.md` §T3 re-run and expanded, 2 AM log entry #5 added.
- [x] Gates green at `a7e9155`: `pnpm typecheck` exit 0 · `pnpm test` 17 shared + 29 api passed · `pnpm lint` exit 0.

## Not Yet Done (your task)

- [ ] 4.1 `job-runner.ts` claim query — use the exact SQL in Checklist step 4.1. No substitutes.
- [ ] 4.2 `backoff.ts`: `min(5000·2^(attempts−1), 300000) + random(0..1000)` ms; `attempts < max_attempts ? queued + run_at = now()+backoff : dead_letter`; mirror to `webhook_events.status` (`failed` while retrying, `dead_letter` at the end, `last_error` set); success → `succeeded`.
- [ ] 4.3 `sweeper.ts`: every 30 s re-queue `status='running' AND locked_at < now() - interval '2 minutes'`.
- [ ] 4.4 `orchestrator/projections/*` — `SELECT … FOR UPDATE`, precedence guard, `version = version + 1`, `last_event_id`; customers upserted with `countryFromContact` / `localeFor` in the new `packages/shared/src/domain/locale.ts`.
- [ ] 4.5 Tests (see step 4.5 for the exact list) **plus the three adversarial cases in "Edge Cases" below**.
- [ ] 4.6 Commit `feat(t04): job worker with SKIP LOCKED and precedence-guarded projections`, then `git tag task-04-done`.
- [ ] Docs in the same task: `Flow.md` F1 step 5 + F3 → `[live]`, `Bug-Feature.md` F-006 + any bug/deviation, `TestChecklist.md` §T4 made real, `Decisions.md` for the two rulings below.

## Failed Approaches (Don't Repeat These)

**B-004 — the T3 ingress let an unauthenticated caller permanently delete a genuine payment event.** It read `x-razorpay-event-id` *before* the HMAC check and used it as the `webhook_events.event_id` idempotency key, and it persisted rejected deliveries under that key. So:

```
attacker → forged signature, header x-razorpay-event-id: evt_X   → 401, but the row is now theirs
Razorpay → genuine signed evt_X                                  → ON CONFLICT → 200 {"status":"duplicate"}, 0 jobs
```

A 200 tells Razorpay **not to retry**, so the event was lost, not delayed. All 27 of Codex's own T3 tests passed over this, because they covered *a* bad signature and *a* good signature separately and never a bad one **followed by** a good one with the same id.

Fixed by `ingressKey()` (`apps/api/src/ingress/razorpay-webhook.ts:66`): unverified deliveries key into `unverified:<sha256(raw body)>`. **Do not "simplify" this back to a single key space.**

The transferable lesson for T4: for every input, ask *who controls this at the moment it is used, and what is it used for?* Then test the **sequence**, not the cases.

**Do not relax `assertSafePaise` to accept strings.** You will be tempted to (see the bigint trap in Warnings). It would violate `C-B6`. Fix the type parser instead.

## Key Decisions (architect rulings — implement these, record each in `Decisions.md`)

| Decision | Rationale |
|---|---|
| **D-032 — add `db/migrations/0003_projection_guards.sql` (+ `.down.sql`)**: `ALTER TABLE orders, payments, invoices, disputes ADD COLUMN last_event_at timestamptz;` and `ALTER TABLE disputes ADD COLUMN version integer NOT NULL DEFAULT 1;` | Checklist step 4.4 as written is **impossible** against the current schema: only `subscriptions` has `last_event_at`, and `disputes` has neither `version` nor any event timestamp (verified against the live `aegis_test` schema — see the table in Warnings). This is a `C-G5` situation and it is pre-authorised so you do not stall: `rzp_created_at` keeps meaning *the entity's own creation time*, `last_event_at` means *the `created_at` of the last event applied*. That makes `isStaleSubscriptionEvent(last_event_at, incoming)` uniform across all five projections. Leave step 4.4's text unchanged and log the deviation as `DV-004`. |
| **D-033 — `invoices.floor_amount_paise = amount_paise` on INSERT; never touched on UPDATE** | The column is `NOT NULL` with no default and Razorpay's invoice payload has no floor. Fail closed: a freshly projected invoice permits **no** discount until T11's negotiator computes a floor deliberately (`C-B3`). Never overwriting it on update preserves seeded and negotiated floors. |
| `process_event` handler re-reads `webhook_events` and **refuses any row with `signature_valid = false`** | Defence in depth after B-004. A row with `signature_valid=false` can exist; the worker must never project one, whatever the queue says. Assert it in a test. |
| Projections upsert in FK order: `customers` → `orders` → `payments` → `disputes` | `payments.order_id → orders(id)`, `payments.customer_id → customers(id)`, `disputes.payment_id → payments(id)`, and every entity's `last_event_id → webhook_events(event_id)`. A `payment.captured` naming an unseen `order_id` violates the FK unless the order row is created first. |

## Current State

**Working**: `/health`; migrations `0001`/`0002` with checksum drift detection; `POST /webhooks/razorpay` end to end (HMAC on raw bytes → transactional upsert + outbox enqueue → `200 accepted|duplicate`). `jobs` rows with `kind='process_event'` are being created and **nothing consumes them yet** — that is your task.

**Broken**: nothing. Gates are green at `task-03-done`.

**Uncommitted changes**: `HANDOFF4.md` (this file) is untracked — commit it with your task or leave it, your choice. Everything else is committed at `a7e9155`.

## Files to Know

| File | Why It Matters |
|---|---|
| `apps/api/src/ingress/reconciler.ts` | Produces your input. `BEGIN` → upsert event → `enqueue` → `COMMIT`. Copy its transaction shape into `db/tx.ts`. |
| `apps/api/src/db/repos/jobs.ts` | `enqueue(tx, {kind, payload, dedupeKey, runAt?})` already exists — **reuse it, do not write a second one.** |
| `apps/api/src/db/pool.ts:12` | Global `pg.types.setTypeParser(20, …)` for bigint. Read the bigint trap in Warnings before writing a single test. |
| `packages/shared/src/domain/precedence.ts` | `PAYMENT_STATUS_RANK` is **already exported** (step 4.4 says "add if missing" — it is not missing). `shouldApplyPaymentTransition`, `isStaleSubscriptionEvent` are done and unit-tested. |
| `packages/shared/src/razorpay/webhook.ts` | The zod entity schemas your projections read. `.passthrough()` everywhere; every field except `id` is optional. |
| `db/migrations/0001_init.sql:44-119` | The five entity tables. Note `payments.status_rank smallint NOT NULL` (no default) and `invoices.floor_amount_paise` (no default). |
| `apps/api/test/ingress.integration.test.ts` | The integration-test pattern to copy: `migrateUp` in `beforeAll`, `TRUNCATE … RESTART IDENTITY CASCADE` in `beforeEach`. |

## Code Context

**Already exported from `@aegis/shared` — do not redefine:**

```typescript
export const PAYMENT_STATUS_RANK: Readonly<Record<PaymentStatus, number>>;  // created0 authorized1 failed1 captured2 refunded3
export function shouldApplyPaymentTransition(current: PaymentStatus | null, incoming: PaymentStatus): boolean;
export function isStaleSubscriptionEvent(lastEventAt: Date | null, incomingEventAt: Date): boolean;  // true => skip
export function assertSafePaise(value: unknown, label?: string): number;   // throws MoneyError on a string
export const KNOWN_EVENT_TYPES: readonly string[];
```

**Existing outbox signature you must call, not reimplement** (`apps/api/src/db/repos/jobs.ts`):

```typescript
export async function enqueue(tx: pg.PoolClient, input: {
  kind: string; payload: Record<string, unknown>; dedupeKey: string; runAt?: Date | null;
}): Promise<{ inserted: boolean; id: number | null }>;
```

**What a `process_event` job looks like in the DB** (produced by T3, verified live):

```
 id |     kind      |          dedupe_key           | status |        payload
----+---------------+-------------------------------+--------+------------------------------
  1 | process_event | process_event:evt_live_victim | queued | {"eventId":"evt_live_victim"}
```

**The row your handler loads from it** — project only when `signature_valid` is true:

```sql
SELECT event_id, event_type, payload, signature_valid, rzp_created_at, status
FROM webhook_events WHERE event_id = $1;
```

**Interfaces to produce** (from Checklist T4):

```typescript
function startWorker(deps: { pools; logger; handlers; concurrency }): { stop(): Promise<void> };
type JobHandler = (job: JobRow, ctx: { db; logger; workerId }) => Promise<void>;
function applyProjection(tx: pg.PoolClient, payload: RazorpayWebhook): Promise<EntitySnapshot>;
// EntitySnapshot { type: EntityType; row: …; customer: … }
function countryFromContact(contact: string | null): string | null;  // +91→IN +1→US +44→GB +971→AE +65→SG else null
function localeFor(country: string | null, notesLocale: string | null): string;
```

**Non-obvious**: `webhook_events.payload` holds the *unmodified* provider JSON (T3 stores `rawRecord`, not the zod output, so schema defaults never rewrite signed bytes). Re-parse it with `RazorpayWebhookSchema` in the handler; don't assume defaults are present.

## Resume Instructions

1. `source ~/.nvm/nvm.sh && nvm use` (Node 24). Confirm `pg_isready -h localhost -p 5432` says *accepting connections*.
2. Write `db/migrations/0003_projection_guards.sql` + `.down.sql` (D-032), then `pnpm db:migrate`.
   - Expected: `applied 1 migration(s)`; `pnpm db:migrate -- --status` → `pending: (none)` and no drift on `0001`/`0002`.
   - If `0001`/`0002` report drift: you edited an applied migration. Revert it — new schema goes in `0003` only.
3. Build 4.1–4.3 (worker) before 4.4 (projections); the worker is testable with a fake handler and no projection code.
4. `pnpm --filter @aegis/api exec vitest run test/worker.integration.test.ts`
   - Expected: 4 loops × 100 jobs → 100 rows `status='succeeded'` with `attempts=1`, zero double-claims.
   - If a job is claimed twice: your claim query lost `FOR UPDATE SKIP LOCKED` or wrapped the subquery wrongly (`C-C4`).
5. Build 4.4, then `pnpm --filter @aegis/api exec vitest run` for the projection tests.
   - Expected: `captured` after `authorized` applies and `version` increments; `authorized` after `captured` leaves `version` unchanged; anything after `failed` ignored; a subscription event with an older `created_at` ignored.
   - If you get `MoneyError: amount must be a non-negative integer paise value … got 149900` — that is the bigint trap in Warnings, not a bug in `money.ts`.
6. Full gate before you claim done: `pnpm typecheck && pnpm test && pnpm lint` — all three, exit 0, output pasted into `HANDOFF5.md` (`C-G2`).
7. Runtime proof: start the API, POST a signed `payment.captured` to `/webhooks/razorpay`, then query the DB.
   - Expected: the `jobs` row moves `queued` → `succeeded`, `webhook_events.status` = `processed`, and a `payments` row exists with `status='captured'`, `status_rank=2`, `version=1`, `last_event_id` set.
   - Port 4000 already has an unrelated API process (pid 31148 as of this handoff). Use another port; stop your own server by PID (`kill $PID`), never `pkill -f` — see 2 AM log #3.

## Setup Required

- `DATABASE_URL` / `DATABASE_URL_TEST` are in `.env` (`aegis` / `aegis_test`, both migrated). Integration tests skip themselves silently if `DATABASE_URL_TEST` is unset — check the test actually ran.
- No LLM keys needed. **Task 4 is a deterministic layer: zero LLM calls** (`C-A1`, `C-A2`). The diff will be grepped for `openai|anthropic|llm|prompt`.
- No new dependency should be needed. If one is, it requires a `Decisions.md` entry and a `~`/exact pin (`C-E4`).

## Edge Cases & Error Handling

Cover these in tests — they are the ones a happy-path suite misses:

- Worker crashes mid-job (`running`, lock held) → sweeper re-queues after 2 minutes; the job must not be lost (`C-C4`). Simulate by inserting a `running` row with `locked_at = now() - interval '5 minutes'`.
- Two workers claim while a **duplicate webhook arrives for the same event** → still exactly one projection, `version` incremented once.
- A `process_event` job whose `webhook_events.signature_valid = false` → handler refuses, marks the job `succeeded` or `cancelled` (your call, document it), projects **nothing**.
- Event references an `order_id` / `customer_id` never seen before → parent row created first, no FK violation.
- `payment.failed` after `payment.captured` for the same id → ignored, `version` unchanged (`shouldApplyPaymentTransition` returns false).
- Handler throws on attempt 1 and 2, succeeds on 3 → `attempts=3`, final `succeeded`, `webhook_events.last_error` cleared or left — document which.
- `max_attempts=2` exhausted → job `dead_letter` **and** `webhook_events.status='dead_letter'` with `last_error` set.

## Warnings

**1. The bigint trap — read this before writing tests.** `amount_paise` is `bigint`, which node-postgres returns as a **string** unless `pg.types.setTypeParser(20, …)` has run. That registration lives in `apps/api/src/db/pool.ts`, but `app.ts` imports `pg` and `./db/pool` **type-only**, so the module is erased and never loaded by tests that build their own pool — which is exactly what `test/ingress.integration.test.ts` does. Proven on this machine:

```
bare pg.Pool (what the T3 integration test builds):
  amount_paise = "149900" -> typeof string
  version      = 3        -> typeof number
after importing src/db/pool.ts (setTypeParser runs):
  amount_paise = 149900   -> typeof number
```

`assertSafePaise("149900")` throws `MoneyError`. So your projections will work in production (`server.ts` imports `pool.ts`) and fail in tests. **Fix the cause, not the symptom**: extract the parser into a side-effect module (e.g. `apps/api/src/db/pg-types.ts`), import it from `pool.ts`, and add it to `setupFiles` in `apps/api/vitest.config.ts` so every test gets it. Loosening `assertSafePaise` violates `C-B6`.

**2. Step 4.4 does not match the schema.** Verified against live `aegis_test`:

| table | `version` | `last_event_at` | `rzp_created_at` |
|---|---|---|---|
| orders | ✓ | ✗ | ✓ |
| payments | ✓ | ✗ | ✓ |
| subscriptions | ✓ | ✓ | ✗ |
| invoices | ✓ | ✗ | ✓ |
| **disputes** | **✗** | **✗** | **✗** |

Migration `0003` (D-032) closes this. Do not silently swap in `rzp_created_at` for `last_event_at` — they mean different things, and `disputes` has neither.

**3. `apps/api/vitest.config.ts` sets `fileParallelism: false`** because integration tests truncate shared tables. Keep it. Your *worker* concurrency test must therefore spawn its 4 loops **inside one test file**, not across files.

**4. Checklist hygiene.** Tick `- [ ]` → `- [x]` and change nothing else in the step text. Codex reworded steps in T2 and it was reverted (`DV-002`); `AGENTS.md` now forbids it. Deviations go in `Bug-Feature.md` → "Deviations", not in the step.

**5. `PAYMENT_STATUS_RANK` already exists** in `packages/shared/src/domain/precedence.ts:9`. Step 4.4's "add if missing" is satisfied — don't create a duplicate.

**6. Commit once, at the end**, then `git tag task-04-done`. Never commit `.env`, `node_modules`, `.next`, `backups/`.

## Next task

Task 5: webhook simulator CLI (`pnpm sim`). Do not start it.
