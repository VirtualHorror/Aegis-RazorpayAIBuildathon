# Handoff 13 — Task 8 + Task 9 complete; blockers B-007 and B-009 fixed

**Generated**: 2026-09-05 14:40 UTC
**Branch**: `main`
**Baseline**: `task-07-done` (`8fd085a`); the existing T9 implementation commit is `072178c`
**Status**: T8 and T9 implemented and green; next task is **Task 10 — SubscriptionSalvager**

## Delivered

- `EventOrchestrator` now routes known events deterministically, projects in a short transaction, supplies `prior_failures_24h` from the failed-payments repository query, diagnoses after commit, evaluates kill switch/cooldown/quiet-hours/daily-budget bounds, persists auditable idempotent proposals, and executes approved actions through two short transactions.
- `executeAction` uses a PostgreSQL session advisory lock keyed by action id while releasing row locks around module code. Outbound messages and ledger entries are persisted atomically, with audit and bus events.
- The process-local event bus and `GET /api/v1/stream` SSE route are mounted with no-cache framing, heartbeats, close cleanup, and `WEB_ORIGIN` CORS. `NoopModule` keeps the registry testable.
- `CheckoutRecovery` emits deterministic per-payment/per-UTC-day retry links, locale-selected WhatsApp templates, schema-valid masked recipients, and pure opt-out/amount/strategy guards. Execution is simulated and audited.
- **B-007 fixed:** `lockOrderSlot` reserves or locks the order identity before either projection touches `customers`; payment projections repair the customer FK before the payment insert. The cold-start interleaving regression passes 9/9.
- **B-009 fixed:** development/test ingress persists only `{ eventId, chaos: 'llm_down' }` on `process_event`; the worker validates that literal and re-enters `runWithLlmChaos` around the orchestrator call. Production ingress omits the field.

## Verification (actual output)

```text
pg_isready
/var/run/postgresql:5432 - accepting connections

pnpm db:status
applied: 0001_init, 0002_readonly_grants, 0003_projection_guards
pending: (none)

pnpm --filter @aegis/api exec vitest run src/orchestrator src/guardrails src/bus src/modules/checkout-recovery test/orchestrator.integration.test.ts src/orchestrator/projections/projections.test.ts test/chaos.integration.test.ts src/worker/process-event.test.ts --no-file-parallelism --maxWorkers=1
Test Files  10 passed (10)
Tests       41 passed (41)

pnpm --filter @aegis/api exec vitest run src/orchestrator/projections/projections.test.ts --no-file-parallelism --maxWorkers=1
Test Files  1 passed (1)
Tests       9 passed (9)

pnpm typecheck && pnpm test && pnpm lint                         # run serially three times
run 1: typecheck 3 projects; shared 5 files / 47 tests; API 31 files / 160 tests; lint 3 projects; exit 0
run 2: typecheck 3 projects; shared 5 files / 47 tests; API 31 files / 160 tests; lint 3 projects; exit 0
run 3: typecheck 3 projects; shared 5 files / 47 tests; API 31 files / 160 tests; lint 3 projects; exit 0
```

The focused T9 module command passed 3 files / 9 tests. The worker chaos command passed the 5-test ingress suite and 2-test worker suite. No live Anthropic or OpenAI output is claimed; local diagnosis tests use the deterministic stub. The shared `aegis_test` database was owned by one Vitest process at a time.

## Paper trail and deviations

- `Architecture.md`, `Flow.md`, `Checklist.md`, `Bug-Feature.md`, `Decisions.md`, and `TestChecklist.md` now describe T8/T9 as live/green and record D-048 (order-slot reservation), D-049 (advisory-lock execution), D-050 (durable chaos propagation), and D-051 (approved-action crash recovery). DV-008 records the consolidated integration-test filename.
- The repository already contained a separate `feat(t09): checkout recovery module` commit (`072178c`); this run preserved it and included the remaining T9 hardening with the T8/blocker changes in the final commit. Stale untracked `HANDOFF6.md`, `HANDOFF8.md`, `HANDOFF10.md`, and `HANDOFF12.md` are intentionally excluded from staging.
- The checklist's T9 commit text remains unchanged for traceability; the combined run is delivered as one final implementation commit plus both task tags.

## Next task

Task 10 — SubscriptionSalvager. Extend the documented lock order (`disputes → payments → orders → customers`, plus subscription/invoice → customers) without inversion, and keep all LLM calls outside row-lock transactions.
