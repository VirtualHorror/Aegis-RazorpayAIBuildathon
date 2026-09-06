# Handoff 12 — Task 7 verified GREEN; Task 8 (EventOrchestrator) unlocked

**Generated**: 2026-09-05 12:11 UTC
**Branch**: `main`
**Baseline for the next review**: `task-07-done` (`8fd085a`) — `git diff task-07-done..HEAD` is currently empty
**Status**: Ready for Codex to start Task 8

## Goal

Build **Task 8 — EventOrchestrator + ActionModule contract + actions audit + SSE bus**: route event → project → diagnose (when needed) → run modules through `propose → guard → persist → (execute | pending_approval | blocked)`, with an in-process event bus streamed over SSE and a `NoopModule` so the pipeline is testable before real modules exist. Full spec: `Checklist.md` §Task 8, `Flow.md` F3 steps 1–7, `Architecture.md` §5.

## Completed (Task 7, verified by Claude this session)

- [x] Task 7 reviewed against `Constraints.md`, `Architecture.md §5/§6`, and every `Checklist.md` step — verdict **GREEN**.
- [x] `TestChecklist.md` §T7 re-run by the verifier, not trusted from the handoff: focused suite 6 files / 44 tests; `pnpm typecheck && pnpm test && pnpm lint` green **three consecutive times** (shared 5 files / 47 tests; api 23 files / 130 tests).
- [x] **C-A7 re-proved on the real shape** — masking a `RETURNING *` payments row plus a `CustomerRow` (not the test's hand-written literal) leaks no email, phone, or full name; nested `card.number` / `cvv` / `expiry_*` are digit-masked at any depth.
- [x] **B-010 found and fixed**: `maskPii` flattened every `Date` to `{}`, silently dropping all five timestamps from every diagnosis prompt. `apps/api/src/llm/mask.ts:78` now passes `Date` through; regression test added.
- [x] **C-A6 given a non-vacuous proof**: new test pins the trace to `['llm', 'sql:INSERT']` with no `BEGIN`; flipping the expected order turns it red (checked).
- [x] **PostgreSQL numeric trap confirmed load-bearing**: the driver really returns the string `"0.900"` for `diagnoses.confidence`; nothing registers OID 1700.
- [x] **D-045 confirmed**: one definition of `ROOT_CAUSES` / `STRATEGIES` / `DiagnoseOutputSchema`; `diagnosis/schema.ts` and `stub-fixtures.ts` re-export only.
- [x] Docs updated: `Checklist.md` (T7 verdict), `TestChecklist.md` §T7, `Bug-Feature.md` (F-009 → verified, B-010, 2 AM log entry 10), `Architecture.md` §13 status row.
- [x] `task-07-done` moved from `ddf3c72` to the verification commit `8fd085a`.

## Not Yet Done — Task 8

- [ ] 8.1 `orchestrator/routing.ts` — deterministic `ROUTES`, exhaustive for the T5 scenarios; unknown event → `ignored`.
- [ ] 8.2 `EventOrchestrator.handle(eventId, workerId)` exactly as `Flow.md` F3 steps 1–7, including the four orchestrator-level guardrails in `guardrails/rules.ts` (kill switch, per-customer cooldown, quiet hours, daily discount budget).
- [ ] 8.3 `execute.ts` `executeAction` — `SELECT … FOR UPDATE`, assert `approved`, persist result / outbound messages / ledger entries, `executed|failed`, audit row, bus publish; an already-`executed` action returns early.
- [ ] 8.4 SSE route `GET /api/v1/stream` — `text/event-stream`, `no-cache`, `x-accel-buffering: no`, `: ping` every 15 s, unsubscribe on close, CORS for `WEB_ORIGIN`.
- [ ] 8.5 Tests per checklist 8.5 (fake module call order, `guard` not called when `propose` returns `null`, kill switch, over-limit → `pending_approval`, duplicate idempotency key, SSE via `app.inject`).
- [ ] 8.6 Commit `feat(t08): event orchestrator, action audit trail and SSE bus`.
- [ ] **B-009 (inherited, T8 owns it)**: carry the development-only chaos flag on the `process_event` job payload and re-enter `runWithLlmChaos` in the worker before calling the diagnostician. The `NODE_ENV` gate stays at ingress.
- [ ] **Supply `prior_failures_24h`** — see Warnings; without it the `>= 3` stopping rule is dead code.
- [ ] Docs: `Flow.md` F3 + F10 → live, `Bug-Feature.md` F-010, `Architecture.md` §13 status row, `TestChecklist.md` §T8.

## Failed Approaches (Don't Repeat These)

- **Unpinned `vitest run` for the API package.** Root `pnpm test` failed with `relation "jobs" does not exist` and contaminated ingress assertions: Vitest 5 spawned one worker per file despite `fileParallelism=false` in `vitest.config.ts`, so a schema suite's migration rollback raced the worker tests on the shared `aegis_test` database. Fixed by putting `--no-file-parallelism --maxWorkers=1` directly in `apps/api/package.json` (D-047, B-005). **Do not remove those flags** to speed up the suite.
- **Running two Vitest processes against `aegis_test` at once.** A focused run overlapping a full gate reported a diagnosis insert deadlock and a projection FK failure — test orchestration, not a production bug. Ensure one `aegis_test` owner before claiming any gate (2 AM log entry 9).
- **Masking tests built from hand-written JSON literals.** They proved only that the literal was masked. `maskPii` was flattening every `Date` to `{}` and no test could see it, because a parsed webhook body has no `Date` — only a `RETURNING *` projection row does. Feed masking tests a value with production provenance and assert on `JSON.stringify` output, since that string is what the provider receives (B-010, 2 AM log entry 10).
- **`purpose: request.purpose` in a hand-built `LlmJsonResult`** → `error TS2353: Object literal may only specify known properties, and 'purpose' does not exist in type 'LlmJsonResult<T>'`. The shape is `{ data, provider, model, latencyMs, tokensIn, tokensOut, raw }` — `raw: string` is required and there is no `purpose` field (`apps/api/src/llm/client.ts:27`).
- **One-off probe scripts in `/tmp`.** `node /tmp/x.cjs` → `Cannot find module 'pg'`, and `npx tsx` from the repo root → `sh: 1: tsx: not found`. Put the probe inside `apps/api/` and run `pnpm --filter @aegis/api exec tsx <file>`, then delete it.

## Key Decisions carried into Task 8

| Decision | Rationale |
|---|---|
| D-045 — `llm/prompts/index.ts` is the only definition of the diagnosis contract | A stub validated against its own copy of the schema is blind to drift; T8 must keep re-exporting, never restate |
| D-046 — unapplied projection snapshots are not diagnosed | A duplicate/stale delivery must not create an audit row or spend a model call; returns `id = 'skipped:<event_id>'`, `provider = 'skipped'`, `degradedReason = 'entity_not_applied'` |
| D-047 — API Vitest pinned to `--no-file-parallelism --maxWorkers=1` | Config-only limits did not serialize the shared PostgreSQL suite under Vitest 5 |
| B-010 — `Date` passes through `maskPii` unchanged | A `Date` has no own enumerable entries, so recursion returns `{}`; dates carry no PII and `JSON.stringify` gives the ISO form |
| C-A6 enforced by type, not convention | `Diagnostician.db` is `Pool`, never `PoolClient`, so a transaction client cannot be injected. Keep that shape in `EventOrchestrator` |

## Current State

**Working**: ingress (T3), worker + precedence-guarded projections (T4), simulator CLI (T5), LLM client + resilience + stub (T6), diagnostician (T7). Full gate green three consecutive runs at api 23 files / 130 tests.

**Broken / open**:
- **B-007 (open, from T4)** — `payment.*` and `order.*` for the same order still deadlock (`40P01`) when the order row is not yet visible to the payment transaction. `lockOrder` is a snapshot-dependent guard: with no row it takes no lock, so `projectPayment` reaches `customers` before `orders`. Self-healing via retry (`attempts=2`), so it shows up as latency, not a red test. Proposed fix is in the B-007 row of `Bug-Feature.md`; needs a `Decisions.md` entry and a cold-start interleaving test.
- **B-009 (open, now owned by T8)** — `x-aegis-chaos: llm_down` lives in an `AsyncLocalStorage` store installed around the *ingress request*; the worker is a separate async context, so the header cannot reach any diagnosis call.

**Uncommitted changes**: none tracked. Three untracked stale files — `HANDOFF6.md`, `HANDOFF8.md`, `HANDOFF10.md` — **do not stage them**.

## Files to Know

| File | Why It Matters |
|---|---|
| `Checklist.md` §Task 8 | The steps to tick. Never reword a step; record deviations in `Bug-Feature.md` |
| `Flow.md` F3 steps 1–7 | The exact orchestrator sequence, including where the transaction ends |
| `Architecture.md` §5 | `EventContext`, `ActionProposal`, `GuardRule`/`GuardResult`, `ExecutionResult`, `ActionModule` — copy verbatim into `orchestrator/types.ts` |
| `apps/api/src/worker/process-event.ts` | Task 4's handler; T8 replaces its body with the orchestrator. Note it re-checks `signature_valid` from the persisted row (D-034) |
| `apps/api/src/worker/registry.ts` | `JobHandler`, `JobRow`, `JobHandlerContext` — the handler signature to keep |
| `apps/api/src/orchestrator/projections/index.ts:23` | `applyProjection(tx, payload, context)` → `EntitySnapshot`; must stay inside the transaction |
| `apps/api/src/diagnosis/diagnostician.ts` | `Diagnostician.diagnose()`; must be called **after** the transaction commits |
| `apps/api/src/db/repos/guardrails.ts:35` | `loadGuardrailConfig(db)`; throws `GuardrailConfigError` on a missing/malformed seeded key |
| `apps/api/src/llm/resilient.ts:23,32` | `runWithLlmChaos(mode, cb)` / `isLlmDown()` — the B-009 re-entry point |
| `db/migrations/0001_init.sql` | `actions`, `outbound_messages`, `ledger_entries`, `audit_log` DDL and their CHECK constraints |

## Code Context

**Call the diagnostician (already built, do not modify):**

```ts
// apps/api/src/diagnosis/diagnostician.ts
new Diagnostician({
  db,                                   // pg.Pool — NOT a PoolClient (C-A6 is enforced by this type)
  llm,                                  // LlmClient from src/llm/factory.ts
  getPriorFailures24h?: (input) => number | Promise<number>,  // T8 must supply the repo query
}).diagnose({ event, payload, entity, priorFailures24h? }): Promise<Diagnosis>

interface Diagnosis {
  id: string;                           // uuid — EXCEPT `skipped:<event_id>` when entity.applied === false
  rootCause: RootCause; strategy: Strategy; confidence: number; rationale: string;
  degraded: boolean; degradedReason?: string;
  crossCheck: { overridden: boolean; notes: string[] };
  provider: string; model: string;      // provider === 'skipped' for the non-persisted result
}
```

**What the projection hands you:**

```ts
// apps/api/src/orchestrator/entity.ts
interface EntitySnapshot {
  readonly type: EntityType;
  readonly row: ProjectionRow;          // { [column]: unknown; id: string; version: number } — a RETURNING * row
  readonly customer: CustomerRow | null;
  readonly applied: boolean;            // false = duplicate or failed precedence guard
}
```

**Chaos re-entry for B-009 (proposed shape):**

```ts
// ingress, development only, when NODE_ENV !== 'production':
// enqueue(tx, input) — apps/api/src/db/repos/jobs.ts:20, EnqueueInput = { kind, payload, dedupeKey, runAt? }
await enqueue(tx, { kind: 'process_event', payload: { eventId, chaos: 'llm_down' }, dedupeKey: `process_event:${eventId}` });

// worker, before the orchestrator's diagnose step:
await runWithLlmChaos(job.payload.chaos === 'llm_down' ? 'llm_down' : undefined, () => orchestrator.handle(...));
```

**Non-obvious SQL constraints (`db/migrations/0001_init.sql`):**

```sql
actions.money_impact_paise      bigint NOT NULL DEFAULT 0 CHECK (money_impact_paise <= 0)   -- never positive
actions.expected_recovery_paise bigint NOT NULL DEFAULT 0 CHECK (expected_recovery_paise >= 0)
actions.idempotency_key         text NOT NULL UNIQUE        -- `${module}:${entityType}:${entityId}:${step}`
actions.diagnosis_id            uuid REFERENCES diagnoses(id)
actions.status  CHECK (status IN ('proposed','blocked','pending_approval','approved','rejected','executed','failed','expired','compensated'))
outbound_messages.status        CHECK (status IN ('simulated_sent','suppressed'))
```

The daily discount budget is therefore `SUM(-money_impact_paise)` over `actions WHERE status IN ('approved','executed','pending_approval')` and `created_at::date = today`.

## Resume Instructions

1. `pg_isready` → expect `/var/run/postgresql:5432 - accepting connections`. If not, tell the human to run `sudo bash scripts/bootstrap-system.sh`; do not work around it.
2. `source ~/.nvm/nvm.sh && node -v` → expect `v24.20.0`.
3. `git log --oneline -1` → expect `8fd085a fix(t07): …`. `git diff task-07-done..HEAD --stat` → expect empty.
4. Read `Checklist.md` §Task 8, `Flow.md` F3, `Architecture.md` §5. Copy the §5 interfaces into `apps/api/src/orchestrator/types.ts` **verbatim** — the reviewer diffs them.
5. Build 8.1 → 8.5, ticking `- [ ]` → `- [x]` as each lands.
6. Confirm nothing else is using the test database, then run the gate three times:
   `pnpm typecheck && pnpm test && pnpm lint`
   - Expected: exit 0 each time; api test count above 130 (T7's verified baseline).
   - If `relation "…" does not exist` or an FK failure appears: another Vitest process is running against `aegis_test`. Stop it and rerun; do not "fix" it in the code.
7. Commit `feat(t08): event orchestrator, action audit trail and SSE bus`, update the docs listed under *Not Yet Done*, and write `HANDOFF13.md` with the exact commands and their real output.

## Setup Required

- `.env` at the repo root (already present): `DATABASE_URL`, `DATABASE_URL_TEST` (`aegis_test`), `DATABASE_URL_READONLY`, `AEGIS_LLM_PROVIDER=auto`, `LLM_TIMEOUT_MS=20000`.
- Node via `source ~/.nvm/nvm.sh` (v24.20.0). `sudo` needs a password — anything privileged goes to the human via `scripts/bootstrap-system.sh`.
- Only an OpenAI-compatible proxy key exists on this machine; there is no `ANTHROPIC_API_KEY`. Use `AEGIS_LLM_PROVIDER=stub` for tests and never claim live model output.
- Stop a dev API with `kill -TERM <pid>` on the **tsx child** PID, never `pkill -f` (it matches the shell's own argv and kills the session — 2 AM log entry 3).

## Edge Cases & Error Handling

- `entity.applied === false` → the diagnostician returns `id = 'skipped:<event_id>'` and persists nothing. **Never write that value into `actions.diagnosis_id`** — the column is `uuid`, so it fails with `22P02 invalid input syntax for type uuid`. Treat a `provider === 'skipped'` diagnosis as "no diagnosis row".
- `LlmUnavailableError` → the diagnostician already degrades to the rule-based fallback (`degraded=true`, confidence `0.6`, rationale prefixed `rule-based fallback:`). The orchestrator must not turn that into a failed job.
- Unknown event type → `ignored`, per 8.1. An invalid-signature row stays `ignored` and must not mutate any entity table (D-034).
- Duplicate `idempotency_key` → `ON CONFLICT DO NOTHING RETURNING *` returns no row; skip, do not error.
- Missing/malformed guardrail key → `loadGuardrailConfig` throws `GuardrailConfigError`; let the job retry rather than defaulting a bound.

## Warnings

- **C-A6.** The transaction ends at `Flow.md` F3 step 3. `resilient.ts` retries once and can wait `2 × LLM_TIMEOUT_MS`, so a diagnose call inside a projection transaction would hold row locks for up to 40 s. Keep the orchestrator's db handle a `Pool`.
- **C-C3 lock order** is `disputes → payments → orders → customers` and `subscriptions|invoices → customers`. T8 must extend it, never invert it. B-007 is still open in exactly this area.
- **`prior_failures_24h` is caller-supplied.** `deriveHints` defaults it to `0` and does not guess. Until T8 wires the repository query, cross-check row 8 (`>= 3` → `ESCALATE_HUMAN`) can never fire in production. Add the query and a test that proves the rule fires end to end.
- **Don't reintroduce `maskPii` recursion into `Date`** (B-010). The regression test in `apps/api/src/llm/mask.test.ts` will catch it.
- **Checklist hygiene**: tick steps, never reword them. Deviations go in `Bug-Feature.md` ("Deviations") and the handoff.
- **One task per handoff.** Finish Task 8 completely — code + tests + docs + commit — and do not begin Task 9.
- Do not stage `HANDOFF6.md`, `HANDOFF8.md`, or `HANDOFF10.md`; they are stale untracked leftovers.
