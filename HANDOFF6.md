# Handoff 6 — Task 5: Razorpay webhook simulator CLI

**Generated**: 2026-09-05 07:35 UTC
**Branch**: `main` (clean apart from this untracked file)
**Status**: Task 4 verified GREEN — Task 5 is unlocked and unstarted
**Baseline tag**: `task-04-done` → `fe4ddbc`. Your diff for review is `git diff task-04-done..HEAD`.

## Goal

Implement `Checklist.md` **Task 5** only: `pnpm sim <scenario>` builds Razorpay-shaped, HMAC-signed webhooks with a seedable RNG, can replay duplicates and fire concurrent bursts, prints a result table, and is also reachable at `POST /api/v1/sim/run` in non-production. Read `AGENTS.md` first; `Constraints.md` is binding; **do not start Task 6.**

## Completed (Task 4, by the Verification Agent — context, not your work)

- [x] T4 verified GREEN. `Checklist.md` T4 heading, `Architecture.md` status table, `Bug-Feature.md` F-006 all say `verified`.
- [x] **B-006 fixed** — one real deadlock found in T4 and repaired in `965577e`. Read "Failed Approaches"; your `--burst` flag is the first thing that will stress it.
- [x] `C-C3` now fixes one global projection lock order; `D-035` explains it; `TestChecklist.md` §T4 has the verification re-run; 2 AM log entry #7 added.
- [x] Gates green at `fe4ddbc`: `pnpm typecheck` exit 0 · `pnpm test` 25 shared + 52 api passed · `pnpm lint` exit 0.

## Not Yet Done (your task)

- [ ] 5.1 `buildWebhook({ event, entityKey, entity, accountId, createdAt })` → the envelope shape in the step; sign with a 3-line HMAC in `scripts/sim/signer.ts` **and unit-test that it equals `computeSignature` from T3**.
- [ ] 5.2 Result table: scenario, status code, `status` field, latency; totals accepted/duplicate/rejected/ignored, p50/p95.
- [ ] 5.3 Commit `feat(t05): razorpay webhook simulator`, then `git tag task-05-done`.
- [ ] All 14 scenario names **exactly** as spelled in Checklist §5, plus `all`. Flags `--dupes N`, `--burst N`, `--seed S`, `--api URL`, `--chaos llm_down`.
- [ ] `apps/api/src/routes/sim.ts`, mounted only when `NODE_ENV !== 'production'` (`C-D5`).
- [ ] `packages/shared/src/sim/scenarios.test.ts` — every scenario validates against `RazorpayWebhookSchema`.
- [ ] Docs in the same task: `Flow.md` F11 → `[live]`, `Bug-Feature.md` F-007, `TestChecklist.md` §T5 made real, `Decisions.md` for any ruling you make.

## Failed Approaches (Don't Repeat These)

**1. `import … from '@aegis/shared'` does not work from `scripts/`.** Proven on this machine just now:

```
$ tsx scripts/probe-import.ts        # import { KNOWN_EVENT_TYPES } from '@aegis/shared';
Error: Cannot find module '@aegis/shared'

$ tsx scripts/probe-rel.ts           # import { KNOWN_EVENT_TYPES } from '../packages/shared/src/index';
relative import OK, known events: 20
```

`scripts/` is not a workspace package, so there is no `node_modules/@aegis` above it — the same root cause as **B-003** (`db/seed`). `db/seed/seed.ts` already solves it the right way: `import { loadConfig } from '../../apps/api/src/config'`. **Use relative paths from `scripts/`.** Do not "fix" this by adding `@aegis/shared` to the root `package.json`, and do not copy the shared code.

**2. B-006 — the T4 projections deadlocked on the commonest Razorpay event pair.** `projectOrder` locked `orders` then upserted `customers`; `projectPayment` upserted `customers` then locked `orders`. Two workers handling `order.paid` and `payment.captured` for the same order and customer each held the row the other wanted → `40P01`, one transaction aborted:

```
payment ERR 40P01 deadlock detected   while locking tuple (0,1) in relation "orders"
```

All 12 of Codex's adversarial worker tests passed over it, because each raced two events for the *same* entity or ran one event at a time — never two projections holding different rows at once. It was also **self-healing**: the aborted job retried and succeeded, so it could only ever show up as latency, never as a red test.

Fixed by splitting `ensureOrder` into `lockOrder` / `createOrder` (`apps/api/src/orchestrator/projections/payments.ts:57-88`). `C-C3` now fixes the order for everyone: **entity row first, then toward the FK root — `disputes → payments → orders → customers`**, with `subscriptions` and `invoices` directly above `customers`.

The transferable lesson for T5: **a green concurrency test is not a concurrency argument.** Your `--burst` is the first code that will drive many distinct entities through the worker at once. If a burst produces any job with `attempts > 1`, that is a lock-order regression, not flakiness — report it, do not raise the timeout.

**3. Do not relax `assertSafePaise`** and do not re-register the int8 parser. `apps/api/src/db/pg-types.ts` is the single side-effect module; `db/pool.ts` imports it and `vitest.config.ts` lists it in `setupFiles`. If you build a bare `pg.Pool` in a new test file, that setup already covers you.

## Key Decisions (architect rulings — implement these, record each in `Decisions.md`)

| Decision | Rationale |
|---|---|
| **Scenario builders live in `packages/shared/src/sim/scenarios.ts`; `scripts/simulate.ts` is a thin CLI driver that imports them relatively.** | Checklist §5 offers this as an option ("if importing from scripts is awkward") and then names the test file `packages/shared/src/sim/scenarios.test.ts`, which settles it. It is also the only arrangement where `apps/api/src/routes/sim.ts` and the CLI share **one** definition: the route can import `@aegis/shared` normally, and the CLI reaches it by relative path. Copying builders into two places would let the dev route and the CLI drift. |
| **Wire the CLI as `apps/api` → `"sim": "tsx ../../scripts/simulate.ts"`.** | The root `package.json` **already** has `"sim": "pnpm --filter @aegis/api run sim"` (line 23) and `apps/api` has no `sim` script, so `pnpm sim` currently fails. Adding the api-side script is the one-line fix; do not rewrite the root script. |
| **Add `../../scripts` to `apps/api/tsconfig.json` `include` and to its `lint` script.** | AGENTS.md rule from B-003: every TS file outside `apps/*`/`packages/*` must be inside a package's typecheck and lint program. `scripts/` holds only `.sh` today, so this is additive. **A green `pnpm typecheck` is not proof your new file is covered** — verify with `tsc --noEmit --listFiles` and grep for `simulate.ts`. |
| **`--dupes N` = N *additional* re-POSTs of the identical body and headers after the original.** | Makes the table read `accepted=1 duplicate=N`, which is what `TestChecklist.md` §T5 already predicts for `--dupes 3`. Exercises `C-C2` and `duplicate_count`. |
| **`bad_signature` must land in the `unverified:<sha256(raw body)>` namespace and must never send an `evt_` id that a real scenario also uses.** | D-031 / B-004. The whole point of that namespace is that an unsigned delivery cannot occupy a genuine key. A simulator that collides the two would silently re-open the vulnerability and its own test would look fine. Assert the stored row's `event_id` starts with `unverified:`. |
| **`--seed S` must make a run byte-reproducible; no `Math.random`, no `Date.now()` inside a builder.** | `scripts/sim/ids.ts` gets a small seeded PRNG (mulberry32 or xorshift is fine, ~6 lines, no dependency) and `createdAt` is a parameter, never read from the clock inside `buildWebhook`. Two runs with the same `--seed` must produce identical bodies, therefore identical signatures. Test that. |
| **`--chaos llm_down` only sets the `x-aegis-chaos: llm_down` header in T5.** | The LLM client that honours it arrives in T6. Send the header, document it as inert, do not stub an LLM. **Zero LLM calls in T5** (`C-A1`, `C-A2`). |

## Current State

**Working**: `/health`; migrations `0001`–`0003`; `POST /webhooks/razorpay` (HMAC over raw bytes → transactional upsert + outbox enqueue → `200 accepted|duplicate`); the worker consumes `process_event` jobs and projects all five entities under the fixed lock order. End to end, live-verified: two concurrent signed deliveries → both jobs `succeeded` at `attempts=1`, order/payment/customer rows correct.

**Broken**: `pnpm sim` — the root script delegates to an `@aegis/api` script that does not exist yet. That is your task.

**Uncommitted changes**: none. `git status` is clean at `fe4ddbc`; `HANDOFF6.md` (this file) is untracked.

## Files to Know

| File | Why It Matters |
|---|---|
| `apps/api/src/ingress/signature.ts:3` | `computeSignature(raw: Buffer, secret: string)` — the 3 lines your `signer.ts` must reproduce. Unit-test equality (step 5.1). |
| `apps/api/src/ingress/index.ts:14` | `{ config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }` on the webhook route. Read the burst warning below. |
| `apps/api/src/ingress/reconciler.ts:50` | Decides whether a job is enqueued: `inserted && signatureValid && status !== 'ignored' && isKnownEventType(...)`. This is why `unknown_event` gets a row but no job. |
| `packages/shared/src/razorpay/events.ts` | `KNOWN_EVENT_TYPES` (20 entries). `settlement.processed` is deliberately absent — that is what `unknown_event` proves. |
| `packages/shared/src/razorpay/webhook.ts` | `RazorpayWebhookSchema` + the five entity schemas your scenarios must satisfy. `.passthrough()` everywhere; every field except `id` is optional. |
| `apps/api/src/app.ts:57-63` | Route registration pattern. Add the sim plugin here, guarded on `config.NODE_ENV !== 'production'`. |
| `apps/api/src/routes/health.ts` | The smallest example of a Fastify route plugin in this repo — copy its shape. |
| `db/seed/seed.ts:5` | The working precedent for importing repo code from outside a workspace package (relative path). |
| `apps/api/test/ingress.integration.test.ts` | Integration-test pattern: `migrateUp` in `beforeAll`, `TRUNCATE … RESTART IDENTITY CASCADE` in `beforeEach`. |

## Code Context

**Reproduce exactly** (`apps/api/src/ingress/signature.ts`):

```typescript
export function computeSignature(raw: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(raw).digest('hex');
}
```

**The envelope `buildWebhook` must emit** (matches `RazorpayWebhookSchema`):

```typescript
{ entity: 'event', account_id: string, event: string,
  contains: [entityKey], payload: { [entityKey]: { entity: <entity> } }, created_at: number }
```

**Headers every POST needs** — sign the **exact bytes you send**, not a re-serialisation (`C-D2`):

```typescript
const raw = Buffer.from(JSON.stringify(body));   // build the string once, send this same buffer
{ 'content-type': 'application/json',
  'x-razorpay-signature': computeSignature(raw, secret),
  'x-razorpay-event-id': eventId }
```

**Ingress responses your table must classify:**

```json
{"status":"accepted","event_id":"evt_...","duplicate_count":0}   // 200, new verified delivery
{"status":"duplicate","event_id":"evt_...","duplicate_count":3}  // 200, same event_id again
{"error":"invalid_signature"}                                    // 401, bad_signature scenario
```

`unknown_event` (`settlement.processed`) returns **200 `accepted`** with a `webhook_events` row and **zero jobs** — it is `ignored` at the enqueue gate, not rejected at the door. Your `ignored` total must come from the DB or from the enqueue result, not from the HTTP status.

**Verify a run actually did something** (use this in `TestChecklist.md` §T5, not just the printed table):

```sql
SELECT status, count(*) FROM webhook_events GROUP BY status;
SELECT status, max(attempts) FROM jobs GROUP BY status;   -- expect max(attempts)=1 after a burst
```

**Non-obvious**: `webhook_events.payload` stores the *unmodified* provider JSON, so a scenario that omits an optional field stays omitted in the DB. Your `scenarios.test.ts` therefore asserts against `RazorpayWebhookSchema.parse(...)` output, but the ingress stores the raw body — do not assume zod defaults are present downstream.

## Resume Instructions

1. `source ~/.nvm/nvm.sh && nvm use` (Node 24). Confirm `pg_isready -h localhost -p 5432` says *accepting connections* and `pnpm db:migrate -- --status` shows three applied, `pending: (none)`.
2. Write `packages/shared/src/sim/scenarios.ts` + `ids.ts` first, export from `packages/shared/src/index.ts`, and get `packages/shared/src/sim/scenarios.test.ts` green **before** touching the CLI.
   - Expected: every scenario parses under `RazorpayWebhookSchema`; two builds with the same `--seed` are deeply equal.
   - If a scenario fails to parse: the entity schemas are `.passthrough()` but `id` is required and `amount` must be a non-negative integer.
3. Write `scripts/sim/signer.ts` and a unit test asserting it equals `computeSignature` for the same bytes. Add `"sim": "tsx ../../scripts/simulate.ts"` to `apps/api/package.json`, and `../../scripts` to that package's `tsconfig.json` include + `lint` script.
   - Verify coverage, don't assume it: `cd apps/api && npx tsc --noEmit --listFiles | grep simulate` must print the file (B-003).
4. Start the API on a **non-default port** with the worker enabled, then run the CLI against it:
   ```
   API_PORT=4041 AEGIS_WORKER_ENABLED=true pnpm --filter @aegis/api start &   # keep the PID
   pnpm sim payment_failed_3ds_intl --dupes 3 --api http://127.0.0.1:4041
   ```
   - Expected: table shows `accepted=1 duplicate=3 rejected=0`, and `webhook_events.duplicate_count = 3` for that event id.
   - If every POST returns `accepted`: you are regenerating the event id per attempt. `--dupes` must resend the **identical body and headers**.
5. `pnpm sim all --api http://127.0.0.1:4041`
   - Expected: 14 rows; `bad_signature` → 401; `unknown_event` → 200 accepted, 0 jobs; every other scenario → a job that reaches `succeeded`.
   - Then `SELECT event_id FROM webhook_events WHERE signature_valid = false;` → must start with `unverified:` (D-031).
6. `pnpm sim burst --burst 50 --api http://127.0.0.1:4041` (or whatever you name the burst entry point — keep it consistent with `TestChecklist.md` §T5, and fix §T5's stale `--n` spelling while you are there).
   - Expected: 50 events, 50 jobs, **`max(attempts) = 1`**, p50/p95 printed.
   - If any job shows `attempts > 1`: check `jobs.last_error`. `deadlock detected` means a lock-order regression (B-006) — stop and report it in `Bug-Feature.md`; do not paper over it with a retry or a longer timeout.
7. Full gate before you claim done: `pnpm typecheck && pnpm test && pnpm lint` — all three, exit 0, real output pasted into `HANDOFF7.md` (`C-G2`).
8. Stop your server by PID (`kill -TERM $PID`), never `pkill -f` — see 2 AM log #3. Verify the port is closed afterwards.

## Setup Required

- `DATABASE_URL` / `DATABASE_URL_TEST` and `RAZORPAY_WEBHOOK_SECRET` are in `.env`. The simulator must read the secret from the environment — **never hardcode or print it** (`C-D3`).
- No LLM keys needed. **Task 5 is a deterministic layer: zero LLM calls** (`C-A1`, `C-A2`). The diff will be grepped for `openai|anthropic|llm|prompt`.
- No new dependency should be needed: `node:util`'s `parseArgs` covers the flags and `fetch` is built in. If you want one anyway, it needs a `Decisions.md` entry and a `~`/exact pin (`C-E4`).
- Integration tests skip themselves silently when `DATABASE_URL_TEST` is unset — check the test actually ran, don't trust a green summary.

## Edge Cases & Error Handling

Cover these; they are the ones a happy-path simulator misses:

- `--burst 400` against the webhook route's **300/min** limit → some POSTs get `429`. Decide and document: cap the burst, print `rate_limited` as its own column, or space the requests. Silently counting a 429 as `rejected` would make the table lie.
- API not running / wrong `--api` → `fetch` throws `ECONNREFUSED`. Print a one-line actionable error and exit non-zero; do not dump a stack trace as the table.
- `--seed` omitted → still reproducible *within* one run (a scenario's ids must not change between its own duplicate POSTs), and the chosen seed must be **printed** so a failing run can be replayed.
- `payment_captured_after_retry` must reuse the **same `order_id`** as the preceding failure in the same run, or the attribution story it exists to tell is fake (`C-F5` in spirit: no faked data).
- Two scenarios in `all` must never emit the same `evt_` id, or the second is answered `duplicate` and its assertion silently passes for the wrong reason.
- `dispute_created` names a `payment_id` the worker has not seen → the dispute projection creates the payment parent. That is expected; assert it rather than seeding the payment first.
- Scenario run twice in one process (`all` then `all`) → second run must produce fresh ids unless `--seed` is pinned. State which.

## Warnings

**1. The webhook route is rate-limited to 300/min** (`apps/api/src/ingress/index.ts:14`), under a global 600/min. `--burst 50` is fine; the `all --dupes` combinations are not obviously fine. Test the number you document.

**2. `pnpm sim` is currently broken by design** — the root script delegates to an `@aegis/api` script that does not exist. Add the api-side script; do not change the root one.

**3. `NODE_ENV !== 'production'` guard on the sim route is a constraint, not a nicety** (`C-D5`). Add a test that `buildApp` with `NODE_ENV: 'production'` returns **404** for `POST /api/v1/sim/run`. A guard nobody tests is a guard that gets refactored away.

**4. Checklist hygiene.** Tick `- [ ]` → `- [x]` and change **nothing else** in the step text. This was reverted once in T2 (`DV-002`) and T4 got it right — keep the streak. Deviations go in `Bug-Feature.md` → "Deviations", not in the step.

**5. `TestChecklist.md` §T5 is stale**: it says `pnpm sim payment_failed_3ds` (Checklist §5 says `payment_failed_3ds_intl`) and `pnpm sim burst --n 50` (Checklist §5 says `--burst N`). **`Checklist.md` §5 wins** — its scenario names are declared exact. Rewrite §T5 to the real invocations as part of your docs update and note it as a deviation.

**6. The development database has leftover probe rows** from the T4 live proofs (`*_task4_live`, `*_v4_live`). Harmless, and `pnpm db:seed` is unaffected. If your simulator needs a clean slate, truncate deliberately and say so — do not delete rows as a side effect of a run.

**7. Commit once, at the end**, then `git tag task-05-done`. Never commit `.env`, `node_modules`, `.next`, `backups/`.

## Next task

Task 6: LLM client abstraction (anthropic / openai / stub) + resilient wrapper + prompt registry. **Do not start it.**
