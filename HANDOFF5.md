# Handoff 5 - Task 4: job worker + precedence-guarded projections

**Generated**: 2026-09-05 07:05 UTC
**Branch**: `main`
**Task status**: Task 4 implemented and acceptance-tested; ready for Verification Agent review
**Next task**: Task 5 (webhook simulator CLI). Do not start it in this handoff.

## What changed

- Added the durable worker in `apps/api/src/worker/`: exact `FOR UPDATE SKIP LOCKED` claim SQL, bounded exponential backoff with jitter, retry/DLQ transitions, webhook status mirroring, handler registry, and a 30-second stale lease sweeper.
- Added `processEventHandler`, which locks and re-reads the `webhook_events` row and checks `signature_valid === true` before parsing or projecting. Invalid-signature jobs are inert and become `succeeded`; the event remains `ignored` for audit (D-034).
- Added deterministic projections for payments, orders, subscriptions, invoices, and disputes. Each projection locks its entity row, applies payment rank or event-time precedence, increments `version` only on an accepted event, records `last_event_id`/`last_event_at`, and creates FK parents in order.
- Added deterministic customer country/locale derivation and upsert logic, including merchant-owned `opted_out` preservation.
- Added migration `0003_projection_guards` for the missing event timestamps and dispute version (D-032), and fail-closed invoice floor initialization (D-033).
- Extracted the PostgreSQL bigint parser to `apps/api/src/db/pg-types.ts`; Vitest loads it before integration pools are created. API tests are file-serial with one configured worker to protect the shared test database.
- Started the worker after API listen and drained it during SIGINT/SIGTERM shutdown.

## Adversarial coverage

`apps/api/test/worker.integration.test.ts` covers four concurrent loops claiming 100 jobs exactly once, duplicate webhooks racing two workers, a retry after a projection commit, invalid-signature queued work, retry/DLQ mirroring, stale lease recovery, unseen FK parents, payment precedence, subscription timestamp precedence, and invoice floor immutability. `apps/api/src/orchestrator/projections/projections.test.ts` additionally races authorized/captured projections and checks duplicate and stale no-ops.

## Verification commands and observed output

Prerequisites and schema:

```text
pg_isready -h localhost -p 5432
localhost:5432 - accepting connections

pnpm db:migrate -- --status
applied: 0001_init, 0002_readonly_grants, 0003_projection_guards
pending: (none)
```

Focused suites:

```text
pnpm --filter @aegis/api exec vitest run test/worker.integration.test.ts
Test Files  1 passed (1)
Tests  12 passed (12)

pnpm --filter @aegis/api exec vitest run src/orchestrator/projections/projections.test.ts
Test Files  1 passed (1)
Tests  7 passed (7)
```

Repository gates, run sequentially after the final changes:

```text
pnpm typecheck
packages/shared: Done
apps/api: Done
apps/web: Done

pnpm test
packages/shared: 4 files / 25 tests passed
apps/api: 9 files / 51 tests passed
apps/web: placeholder tests passed

pnpm lint
packages/shared: Done
apps/api: Done
apps/web: Done
```

The required combined gate was also run as `pnpm typecheck && pnpm test && pnpm lint`; it completed with exit code 0. Its test portion reported `packages/shared: 4 files / 25 tests passed`, `apps/api: 9 files / 51 tests passed`, and the web placeholder; typecheck and lint reported `Done` for all three packages.

Live proof used `API_PORT=4024 NODE_ENV=production AEGIS_WORKER_ENABLED=true pnpm --filter @aegis/api start`. The signed raw request and database query produced:

```text
response: {"status":"accepted","event_id":"evt_task4_live","duplicate_count":0} http=200
state: succeeded|processed|captured|2|1|evt_task4_live
parents: 1|1|1
health: {"status":"ok","db":"ok","db_latency_ms":1,"version":"0.1.0","uptime_s":40,"timestamp":"2026-09-05T06:59:46.740Z"}
```

The owned API process was stopped with `kill -TERM 81136`; no unrelated process was touched. The live row uses `pay_task4_live`, `order_task4_live`, and `cus_task4_live` and remains as a harmless development-database probe.

## Documentation

Updated `Checklist.md`, `Flow.md`, `Architecture.md`, `Bug-Feature.md`, `Decisions.md`, and `TestChecklist.md`. F-006 records the implementation and evidence; D-032 through D-034 and DV-004 explain the schema, invoice-floor, and signature decisions. `HANDOFF4.md` is retained as the architect's input handoff.

## Deviations and unverified items

- DV-004: `0003_projection_guards` was required because the baseline schema lacked the event timestamps on four tables and `version` on disputes; this was pre-authorized in HANDOFF4 and recorded in `Bug-Feature.md`.
- No LLM calls or new dependencies were needed for Task 4. No API-key-dependent behavior was exercised.
- The Verification Agent has not yet performed the final diff review; Task 5 remains out of scope.
