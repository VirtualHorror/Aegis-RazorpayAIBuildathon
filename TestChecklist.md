# Test checklist — concrete commands and expected outputs

> Run from the repo root unless stated. Paste real output into the handoff. Sections are added per task; a task is not done until its section passes.
> Prerequisite for anything touching the DB: `scripts/bootstrap-system.sh` has been run once (PostgreSQL 16 + roles + databases).

## T1 — environment and scaffold — **verified 2026-09-05 (Claude)**

Legend: ✅ ran, output matched · ⏳ blocked until the human runs the sudo bootstrap once.

```bash
# toolchain (user-level)                                    # observed
source ~/.nvm/nvm.sh && node -v                             # ✅ v24.20.0
pnpm -v                                                     # ✅ 11.25.0
cat .nvmrc                                                  # ✅ 24

# PostgreSQL — run ONCE as a human: sudo bash scripts/bootstrap-system.sh
pg_isready -h localhost -p 5432                             # ⏳ expect: localhost:5432 - accepting connections
psql "postgres://aegis:aegis_dev_password@localhost:5432/aegis" -c "select current_user, version();"          # ⏳ aegis | PostgreSQL 16.x
psql "postgres://aegis_readonly:aegis_readonly_password@localhost:5432/aegis" -c "create table t(x int);"      # ⏳ ERROR: cannot execute CREATE TABLE in a read-only transaction

# workspace
pnpm install --frozen-lockfile                              # ✅ "Already up to date" / Done (488 packages)
pnpm typecheck                                              # ✅ shared, api, web: Done (web runs `next typegen` first)
pnpm test                                                   # ✅ shared 14 tests · api 9 tests · web placeholder
pnpm lint                                                   # ✅ shared, api (root eslint.config.mjs), web (eslint-config-next): Done
pnpm --filter @aegis/web build                              # ✅ next build: "/" dynamic, "/_not-found" static

# API (started with `pnpm --filter @aegis/api start`, stopped with kill -TERM <pid>)
curl -s localhost:4000/health
# ✅ {"status":"degraded","db":"unavailable","db_latency_ms":0,"error":"connect ECONNREFUSED 127.0.0.1:5432","version":"0.1.0",...}  HTTP 200
#    (after bootstrap: {"status":"ok","db":"ok",...})
curl -s -w "%{http_code}" localhost:4000/nope               # ✅ {"error":"not_found","details":"GET /nope","request_id":"<uuid>"} 404
curl -s -D - -H "Origin: http://localhost:3000" localhost:4000/health | grep -i access-control-allow-origin   # ✅ http://localhost:3000
kill -TERM <pid>                                            # ✅ log: "shutting down" signal SIGTERM; process exited
tsx src/db/migrate-cli.ts                                   # ✅ prints usage, exit 2 (and importing the module has no side effects)

# Web (started with `pnpm --filter @aegis/web dev`)
curl -s localhost:3000 | grep -o "Made with 💖 by Nabhanyu for Razorpay AI Buildathon"   # ✅ footer text
curl -s localhost:3000 | grep -o 'suppressHydrationWarning\|aria-label="Colour theme"'  # ✅ both present (theme plumbing)
curl -s localhost:3000 | grep -o '₹4,20,000.00'             # ✅ @aegis/shared formatInr rendered through transpilePackages
curl -s localhost:3000 | grep -o '<title>[^<]*</title>'     # ✅ <title>Aegis — The Agentic Merchant OS for Razorpay</title>

# Git
git log --oneline | head -3                                 # ✅ initial scaffold commit, tag task-01-done
git status --porcelain | wc -l                              # ✅ 0
```

## T2 — migrations + schema + seed — **verified 2026-09-05 (Claude)**

```bash
pnpm db:migrate                             # applied 0001_init, 0002_readonly_grants; applied 2 migration(s)
pnpm db:migrate -- --status                 # applied: 0001_init, 0002_readonly_grants; pending: (none)
pnpm db:migrate:down                        # reverted 0002_readonly_grants; re-apply works
pnpm db:migrate                             # applied 0002_readonly_grants; applied 1 migration(s)
psql $DATABASE_URL -c "\dt"                 # 21 relations (schema_migrations + 20 domain tables)
psql $DATABASE_URL -c "select count(*) from guardrail_config"    # 12
pnpm db:seed                                # seeded: customers=12, products=16, guardrails=12, invoices=3, subscriptions=4, orders=6
pnpm db:seed                                # same counts on idempotent rerun
psql $DATABASE_URL_READONLY -c "select email from customers limit 1"   # ERROR: permission denied for table customers
pnpm --filter @aegis/api test -- migrate    # 4 files passed, 14 tests passed
```

Observed on 2026-09-05: `\dt` listed `actions`, `audit_log`, `compliance_flags`, `compliance_scan_runs`, `customers`, `diagnoses`, `disputes`, `evidence_packets`, `guardrail_config`, `invoices`, `jobs`, `ledger_entries`, `nl_queries`, `orders`, `outbound_messages`, `payments`, `products`, `schema_migrations`, `subscriptions`, `webhook_events`, and `x402_payments`. PostgreSQL denied the omitted customer email column as expected. The migration suite also exercised the `aegis_test` down/up round trip and typed guardrail loader.

Verification Agent additions (Claude, 2026-09-05) — every line below was run on this VM, output as observed:

```bash
pnpm db:backup                                              # ✅ backup written: backups/aegis-20260905-101633.sql (52 KB, gitignored)
pnpm db:migrate:down && pnpm db:migrate:down                # ✅ reverted 0002_readonly_grants, reverted 0001_init; pg_tables → schema_migrations only
pnpm db:migrate                                             # ✅ applied 0001_init, applied 0002_readonly_grants, applied 2 migration(s); \dt → 21 relations
# Checklist 2.1 DDL vs 0001_init.sql minus comments        # ✅ identical: 182 lines, 20 tables, 6 indexes, 21 `-- Intent:` comments
psql $DATABASE_URL_READONLY -c "select id, country, locale, opted_out from customers limit 1"   # ✅ cus_001|IN|en-IN|f   (granted columns work)
psql $DATABASE_URL_READONLY -c "select name from customers limit 1"                             # ✅ ERROR: permission denied for table customers (same for contact, notes, *, and payments.email/contact/card_issuer/error_description)
psql $DATABASE_URL_READONLY -c "update guardrail_config set value='true' where key='kill_switch'"   # ✅ ERROR: cannot execute UPDATE in a read-only transaction
psql $DATABASE_URL_READONLY -c "select pg_sleep(6)"                                             # ✅ ERROR: canceling statement due to statement timeout (5 s role setting)
# information_schema.table_privileges / column_privileges for aegis_readonly: 18 tables SELECT-only; customers → id,country,locale,opted_out,created_at,updated_at; payments → the 17 columns of step 2.3; after `db:migrate:down` (0002) → 0 rows each
(cd apps/api && tsx src/server.ts)     # with 0002 pending  # ✅ exit 1: pending migrations — run `pnpm db:migrate` (or set AEGIS_ALLOW_PENDING_MIGRATIONS=true)
sed 's/aegis_readonly/aegis_readonly_missing/g' db/migrations/0002_readonly_grants.sql | psql $DATABASE_URL_TEST -v ON_ERROR_STOP=1   # ✅ WARNING: role aegis_readonly_missing does not exist; skipping readonly grants — exit 0 (down file: same, "…grant rollback")
# probe migration 9998 (`DO $$ BEGIN RAISE WARNING … END $$`) through migrateUp/migrateDown on aegis_test   # ✅ log.warn("migration 9998_notice_probe: probe warning from up sql") and the down variant; no leftover schema_migrations row
curl -s localhost:4000/health          # after migrate; server PID-killed afterwards   # ✅ {"status":"ok","db":"ok","db_latency_ms":1,"version":"0.1.0",...}
pnpm typecheck && pnpm test && pnpm lint                    # ✅ shared 14 tests · api 14 tests (4 files) · web placeholder; typecheck and lint now include db/seed (B-003, D-030)
```

## T3 — webhook ingress (acceptance, verified 2026-09-05)

```bash
pnpm --filter @aegis/api test -- ingress
# unit: signature valid/invalid/length-mismatch; eventId fallback to sha256
# integration (aegis_test): 20 concurrent identical POSTs → 1 row, duplicate_count=19, exactly 1 job; invalid signature → 401 + row with signature_valid=false
curl -s -X POST localhost:4000/webhooks/razorpay -H 'content-type: application/json' -d '{}'   # 401 {"error":"invalid_signature"}
```

Observed on 2026-09-05:

```text
pnpm --filter @aegis/api test -- ingress
Test Files  6 passed (6)
Tests  27 passed (27)

The integration suite verified: valid event → 1 event row + 1 process_event job; sequential duplicate → duplicate_count=1 with one job; Promise.all of 20 identical posts → 1 row, duplicate_count=19, exactly 1 job; invalid signature → 401 with signature_valid=false and zero jobs; unknown event → accepted/ignored with zero jobs; schema-invalid authenticated event → 202/ignored with last_error; missing event id → sha256:<64 hex> key.

API_PORT=4010 pnpm --filter @aegis/api start + curl -X POST http://localhost:4010/webhooks/razorpay -H 'content-type: application/json' -d '{}'
HTTP/1.1 401 Unauthorized
{"error":"invalid_signature"}

pnpm typecheck && pnpm test && pnpm lint
packages/shared: typecheck Done; 3 test files / 17 tests passed; lint Done
apps/api: typecheck Done; 6 test files / 27 tests passed; lint Done
apps/web: typecheck Done; lint Done; placeholder tests Done
```

Port 4000 already had an existing API process during the runtime probe, so the same production server was started on 4010; no unrelated process was stopped.

Re-run by Claude (Verification Agent) on 2026-09-05, after fixing B-004:

```text
pnpm --filter @aegis/api exec vitest run test/ingress.integration.test.ts
Test Files  1 passed (1)      Tests  10 passed (10)

pnpm typecheck && pnpm test && pnpm lint
packages/shared: typecheck Done; 3 files / 17 tests passed; lint Done
apps/api:        typecheck Done; 6 files / 29 tests passed; lint Done
apps/web:        typecheck Done; lint Done; placeholder tests Done
```

Red-green proof for the new regression test (`does not let an unsigned request claim the idempotency key of a genuine event`) — revert only `ingressKey(...)` in `razorpay-webhook.ts` and the test fails while the other nine still pass:

```text
fix reverted:  × does not let an unsigned request claim ...   Tests  1 failed | 9 passed (10)
fix restored:  Test Files  1 passed (1)                       Tests  10 passed (10)
```

Live HTTP probe (real socket, `API_PORT=4021`, `NODE_ENV=production`, DB `aegis_test`) — forged request first, genuine delivery second, Razorpay retry third:

```text
1) FORGED signature, claims evt_live_victim:  {"error":"invalid_signature"}                                      HTTP 401
2) GENUINE signature, same event id:          {"status":"accepted","event_id":"evt_live_victim","duplicate_count":0}   HTTP 200
3) RAZORPAY RETRY (same genuine delivery):    {"status":"duplicate","event_id":"evt_live_victim","duplicate_count":1}  HTTP 200

                                  event_id                                   |  status  | signature_valid | duplicate_count
-----------------------------------------------------------------------------+----------+-----------------+-----------------
 unverified:4fbe5753da78c8425c2f4e3ce8f008d94d3b6d9fb83bd4457b6f8c596e443df4 | ignored  | f               |               0
 evt_live_victim                                                             | received | t               |               1

 jobs |          dedupe_key
------+-------------------------------
    1 | process_event:evt_live_victim
```

The same probe proves C-D2 end-to-end: the signed body carries newlines, two-space indentation and `"event" : ` spacing that `JSON.stringify(JSON.parse(body))` does not reproduce, and it still verifies — so the HMAC is taken over the raw bytes, not a re-serialisation. `content-type: application/json; charset=utf-8` also reaches the Buffer parser (`evt_live_charset` → accepted, 1 job). Probe server stopped by PID (`kill 51908`); the unrelated process on port 4000 (pid 31148) was left running.

## T4 — worker + projections (acceptance, passed 2026-09-05)

```bash
pg_isready -h localhost -p 5432
# localhost:5432 - accepting connections

pnpm db:migrate -- --status
# applied: 0001_init, 0002_readonly_grants, 0003_projection_guards
# pending: (none)

pnpm --filter @aegis/api exec vitest run test/worker.integration.test.ts
# Test Files  1 passed (1)
# Tests  12 passed (12)
# Duration  3.13s

pnpm --filter @aegis/api exec vitest run src/orchestrator/projections/projections.test.ts
# Test Files  1 passed (1)
# Tests  7 passed (7)
# Duration  1.60s

pnpm typecheck
# packages/shared: Done; apps/api: Done; apps/web: Done

pnpm test
# packages/shared: 4 files / 25 tests passed
# apps/api: 9 files / 51 tests passed
# apps/web: placeholder tests passed

pnpm lint
# packages/shared: Done; apps/api: Done; apps/web: Done

# Live proof (API_PORT=4024, worker enabled, stopped with kill -TERM <owned PID>)
# response: {"status":"accepted","event_id":"evt_task4_live","duplicate_count":0} http=200
# state: succeeded|processed|captured|2|1|evt_task4_live
# parents: 1|1|1
# health: {"status":"ok","db":"ok","db_latency_ms":1,"version":"0.1.0","uptime_s":40,"timestamp":"2026-09-05T06:59:46.740Z"}
```

The integration suites exercise four concurrent claim loops over 100 jobs, duplicate webhook delivery racing two workers, a projection that retries after its first commit, invalid-signature queue entries, retry/DLQ mirroring, stale lease recovery, unseen FK parents, payment precedence, subscription timestamp precedence, and immutable invoice floors. The full root gates and the live HTTP proof are recorded in `HANDOFF5.md`.

### T4 verification re-run (Claude, 2026-09-05) — GREEN after fixing B-006

```bash
pnpm db:migrate -- --status
# applied: 0001_init, 0002_readonly_grants, 0003_projection_guards
# pending: (none)

pnpm typecheck   # packages/shared: Done; apps/api: Done; apps/web: Done
pnpm test        # shared 4 files / 25 tests · api 9 files / 52 tests   (51 + the B-006 regression)
pnpm lint        # packages/shared: Done; apps/api: Done; apps/web: Done
```

B-006 red-green (the only change to Codex's code):

```text
Codex's payments.ts restored:  × does not deadlock when an order event and a payment event share an order and a customer
                               error: deadlock detected  code 40P01  at ensureOrder (payments.ts:66)
                               Tests  1 failed | 7 passed (8)
fix restored:                  Test Files  1 passed (1)          Tests  8 passed (8)
```

Live HTTP proof (`API_PORT=4031`, `NODE_ENV=production`, `AEGIS_WORKER_ENABLED=true`, `WORKER_CONCURRENCY=4`, DB `aegis`) — the deadlocking pair delivered concurrently:

```text
evt_v4_live_order    http=200 {"status":"accepted","event_id":"evt_v4_live_order","duplicate_count":0}
evt_v4_live_payment  http=200 {"status":"accepted","event_id":"evt_v4_live_payment","duplicate_count":0}

jobs|2|process_event|succeeded|1|          <- attempts=1: no deadlock abort, no retry
jobs|3|process_event|succeeded|1|
events|evt_v4_live_order|processed|
events|evt_v4_live_payment|processed|
order|order_v4_live|paid|149900|1|evt_v4_live_order
payment|pay_v4_live|captured|149900|order_v4_live|cus_v4_live|1|evt_v4_live_payment
customer|cus_v4_live|IN|en-IN|+91******42

grep -ic 'deadlock|40P01' api.log  ->  0
```

Defence in depth confirmed by reading the code and the suite, not the handoff: `process_event` re-reads `signature_valid` under `FOR UPDATE` *before* `RazorpayWebhookSchema.parse` and before any projection; a queued invalid-signature event leaves zero rows in `payments`/`orders`/`customers`, the job ends `succeeded` (inert, never retried) and the event stays `ignored` (D-034). The node-postgres int8 trap is solved by the side-effect module `apps/api/src/db/pg-types.ts` — imported by `db/pool.ts` and listed in Vitest `setupFiles` — and `git diff task-03-done..HEAD -- packages/shared/src/money.ts` is empty, so `assertSafePaise` was not loosened. Server stopped with `kill -TERM 88476` (owned PID); no unrelated process touched.

Probe rows `order_v4_live` / `pay_v4_live` / `cus_v4_live` (and Codex's `*_task4_live`) remain in the development database as harmless projections; `pnpm db:seed` is unaffected by them.

## T5 — simulator (acceptance, passed 2026-09-05; re-run by Claude on port 4061)

```bash
pg_isready -h localhost -p 5432                    # localhost:5432 - accepting connections
pnpm db:status                                     # applied: 0001_init, 0002_readonly_grants, 0003_projection_guards / pending: (none)

# Coverage proof — scripts/ is a real part of the typecheck and lint programs, not just green by absence (C-E2, B-003).
(cd apps/api && pnpm exec tsc --noEmit --listFiles | grep -c 'RazorpayAIBuildathon/scripts/')
# ✅ 9 — simulate.ts plus sim/{cli,ids,output,scenarios,signer,transport,types,verification}.ts
(cd apps/api && pnpm exec eslint src test ../../db/seed ../../scripts --max-warnings 0 --format json)
# ✅ 57 files linted, 9 of them under scripts/, 0 errors 0 warnings

pnpm --filter @aegis/shared exec vitest run src/sim/scenarios.test.ts
# ✅ Test Files 1 passed · Tests 22 passed (incl. the contended-burst fixture shape)
pnpm --filter @aegis/api exec vitest run test/sim-signature.test.ts test/app.test.ts
# ✅ Test Files 2 passed · Tests 6 passed (signer == ingress HMAC, production 404, dev-route delivery cap)

# API_PORT=4061 NODE_ENV=development AEGIS_WORKER_ENABLED=true pnpm --filter @aegis/api start
# (owned PID, stopped with kill -TERM afterwards; the unrelated process on port 4000 was left alone)

pnpm sim all --seed t5-verify-final --api http://127.0.0.1:4061
# ✅ 14 rows; totals accepted=12 duplicate=0 rejected=1 ignored=1 rate_limited=0
# ✅ unknown_event is HTTP 200 but durable status=ignored with zero jobs; bad_signature is HTTP 401 and
#    bad_signature namespace=unverified:7f8eeaff492ea2139cbb8a435c5620e814436c74ff56ee8165b699c47829c7ef (C-C1, D-031, D-038)

pnpm sim payment_failed_3ds_intl --dupes 3 --seed t5-verify-dupes --api http://127.0.0.1:4061
# ✅ totals accepted=1 duplicate=3 rejected=0 ignored=0 rate_limited=0

pnpm sim burst --burst 50 --seed t5-verify-b50 --api http://127.0.0.1:4061
# ✅ totals accepted=50; burst verification jobs=50/50 succeeded=50 max_attempts=1 contended=false
# ⚠️  contended=false is the point: SELECT count(DISTINCT order_id), count(DISTINCT customer_id) over those 50 payments
#     returned 50 and 50, so no two jobs shared a row and max_attempts=1 could not have failed (D-042).

pnpm sim burst --burst 400 --seed t5-verify-b400 --api http://127.0.0.1:4061
# ✅ totals accepted=232 duplicate=0 rejected=0 ignored=0 rate_limited=168 — 429s are their own total, never rejected (D-040)
# ✅ latency p50=332ms p95=385ms (over 232 delivered request(s); rate_limited excluded)

pnpm sim burst --burst 40 --contend --seed t5-verify-contend2 --api http://127.0.0.1:4061
# ✅ totals accepted=40 (all delivered, clear rate window)
# ❌ simulator error: CRITICAL lock-order regression: burst job evt_000b_064cf66f has attempts=2 — exit 1
#    This is B-007, an open T4 defect, not a simulator fault: pg_stat_database.deadlocks for `aegis` went 1 → 2 across one
#    contended run and the transient jobs.last_error captured mid-retry reads `deadlock detected`. Expect exit 1 here until
#    B-007 is fixed; then this becomes the standing lock-order probe.

pnpm sim payment_failed_3ds_intl --api http://127.0.0.1:4999
# ✅ simulator error: simulator could not reach http://127.0.0.1:4999/webhooks/razorpay: fetch failed — exit 1

DATABASE_URL='postgres://nobody:nobody@127.0.0.1:5999/nowhere' \
  pnpm --filter @aegis/api sim unknown_event --seed t5-nodb-check --api http://127.0.0.1:4061
# ✅ warning: database classification lookup failed: connect ECONNREFUSED 127.0.0.1:5999
# ✅ simulator error: could not verify unknown_event ... in webhook_events; DATABASE_URL is required — exit 1 (fails closed)

curl -s -X POST http://127.0.0.1:4061/api/v1/sim/run -H 'content-type: application/json' \
  -d '{"scenario":"unknown_event","seed":"t5-devroute-check"}'
# ✅ {"seed":"t5-devroute-check","results":[{"status":"ignored",...}],"totals":{"ignored":1,...}} — same classification as the CLI
# ✅ NODE_ENV=production → 404 (C-D5, apps/api/src/app.ts:65 registers the plugin only when NODE_ENV !== 'production';
#    NODE_ENV is a strict zod enum, so a typo fails config load rather than silently mounting the route)

pnpm typecheck && pnpm test && pnpm lint
# ✅ typecheck 3 projects · shared 5 files/47 tests · api 10 files/55 tests · lint 3 projects, all including scripts/
```

The CLI prints the selected seed so an omitted seed can be replayed. `--dupes N` reuses one body and header set; `--burst N` creates distinct seeded events concurrently; `--burst N --contend` aims them at one order and one customer. Every original delivery must reach its scenario's terminal state or the run exits non-zero naming the seed to change (D-043) — a seeded event id that already exists in `webhook_events` used to print `accepted=0 duplicate=N` and exit 0, which reads like a result rather than a collision.

Probe rows from these runs (`acc_simulator` payments/orders/customers and ~700 `evt_*` webhook events) remain in the development database as harmless projections; `pnpm db:seed` is unaffected by them.

## T6 — LLM client (acceptance, verified)

```bash
# NOTE: this does not filter. pnpm forwards `llm` but vitest runs the whole API suite, which is why the counts below
# are the full suite's. Use `pnpm --filter @aegis/api exec vitest run src/llm` to run the LLM files alone.
AEGIS_LLM_PROVIDER=stub pnpm --filter @aegis/api test -- llm
# ✅ 18 API files / 89 tests passed: stub routing + schema validation, OpenAI proxy/repair parsing, mocked Anthropic
#    parsing, PII masking, timeout/retry/breaker/chaos resilience, factory, /api/v1/system, and the chaos header suite.

AEGIS_LLM_PROVIDER=stub pnpm --filter @aegis/api llm:smoke
# ✅ provider=stub model=fixture-v1
# ✅ {"root_cause":"THREE_DS_AUTH_FAILED","confidence":0.9,"intervention_strategy":"RETRY_LINK_LOCALIZED",...} (exit 0)

# Development-only chaos header, end to end (C-D5). The probe runs in the ingress `onEvent` hook, which the handler
# awaits inside the chaos context, so this exercises header -> AsyncLocalStorage -> ResilientLlmClient, not the store alone.
pnpm --filter @aegis/api exec vitest run test/chaos.integration.test.ts
# ✅ 4 tests passed: development + `x-aegis-chaos: llm_down` -> LlmUnavailableError('chaos_llm_down') with the provider
#    never invoked; production + the same header -> provider called normally; no header -> normal; no context leak.
# ⚠️ B-009: this only covers LLM calls made *during the request*. The worker runs in its own async context, so the
#    header cannot reach a diagnosis call made there. T7 must carry the flag on the job, not rely on the store.

# Robust fail-closed check: override DATABASE_URL with an unreachable host; do not use `env -u` because simulate.ts
# loads the repository .env after parsing flags. Run against an isolated API on a free port.
DATABASE_URL='postgres://nobody:nobody@127.0.0.1:5999/nowhere' \
  pnpm --filter @aegis/api sim unknown_event --seed t6-claude-verify-20260905 --api http://127.0.0.1:4088
# ✅ warning: database classification lookup failed: connect ECONNREFUSED 127.0.0.1:5999
# ✅ simulator error: could not verify unknown_event evt_0002_27f22d3d in webhook_events; DATABASE_URL is required for ignored classification (exit 1)

curl -s http://127.0.0.1:4088/api/v1/system
# ✅ {"provider":"stub","model":"fixture-v1","modelFast":"fixture-v1"} — description only, never a credential.
# ✅ the API log shows `llm provider selected` exactly once, at boot.

pnpm typecheck && pnpm test && pnpm lint
# ✅ full gate green on three consecutive runs: typecheck 3 projects; shared 5 files/47 tests; API 18 files/89 tests;
#    lint 3 projects. Run it more than once — B-008 was a ~1-in-4 flake that a single green run hid.

pnpm --filter @aegis/api exec tsc --noEmit --listFiles | grep 'apps/api/scripts/llm-smoke.ts'
# ✅ /home/nabhanyu/Downloads/RazorpayAIBuildathon/apps/api/scripts/llm-smoke.ts
# ✅ the smoke script is included in strict TypeScript coverage (and `scripts` is included in the API lint script).
```

The smoke and provider tests use the deterministic stub for live local execution. Anthropic is SDK-mock-tested only:
`ANTHROPIC_API_KEY` is not present on this machine, so no live Anthropic output is claimed. The OpenAI-compatible proxy
key is available, but its live chat request did not complete within the configured timeout; the adapter behavior is covered
by mocked tests. Rate-limit-sensitive simulator bursts are not used as T6 evidence; the ingress limiter's 300/min window
must be allowed to clear before any later burst probe.

## T7 — diagnostician (acceptance, pending)

```bash
pnpm --filter @aegis/api test -- diagnosis
# hints derived correctly for 6 fixtures; cross-check overrides recorded; fallback used when llm throws; diagnoses row written
```

## T8 — orchestrator (acceptance, pending)

```bash
pnpm --filter @aegis/api test -- orchestrator
# route table covers every scenario; unknown type → ignored; module propose/guard/execute called in order; blocked when kill_switch; pending_approval above limit; idempotency_key conflict skips
curl -N localhost:4000/api/v1/stream         # heartbeat every 15s; events appear when sim runs
```

## T9–T12 — modules (acceptance, pending)

```bash
pnpm --filter @aegis/api test -- modules
# checkout_recovery: locale → template; cooldown blocks 2nd message; opted_out blocks
# subscription_salvager: transition table exhaustive; retry_count stops at max; recovered on charged
# b2b_negotiator: offer never below floor or above max pct; round 4 → escalated; > limit → pending_approval
# chargeback_evidence: packet contains all sections; review_status requires_human_review; never auto-submitted
pnpm sim all && psql $DATABASE_URL -c "select module,status,count(*) from actions group by 1,2 order by 1,2"
```

## T13 — approvals + ledger + metrics (acceptance, pending)

```bash
curl -s localhost:4000/api/v1/approvals | jq length                  # > 0 after sim
curl -s -X POST localhost:4000/api/v1/actions/<id>/decision -d '{"decision":"approve","note":"ok","actor":"human:nabhanyu"}'  # 200, status executed
curl -s localhost:4000/api/v1/metrics/summary | jq                    # money_recovered_paise, discounts_granted_paise, dedupe counts, llm degraded %
```

## T14 — x402 (acceptance, pending)

```bash
curl -si localhost:4000/x402/products/prod_001/spec | head -1        # HTTP/1.1 402
pnpm x402:buy prod_001                                                # 200 + X-PAYMENT-RESPONSE decoded; ledger row x402_revenue
pnpm x402:buy prod_001 --replay                                       # 402 {"error":"nonce_already_settled"}
pnpm x402:buy prod_big --amount 999999                                # 402 {"error":"amount_exceeds_policy"}
```

## T15 — Ask Aegis (acceptance, pending)

```bash
curl -s -X POST localhost:4000/api/v1/ask -d '{"question":"How much revenue did we recover this week by module?"}' | jq '.sql,.rows'
curl -s -X POST localhost:4000/api/v1/ask -d '{"question":"drop table payments"}' | jq '.error'   # validation error, nothing executed
curl -s -X POST localhost:4000/api/v1/ask -d '{"question":"forecast failed payments for the next 7 days"}' | jq '.forecast | length'   # 7
pnpm --filter @aegis/api test -- nlq          # validator rejects UPDATE/DELETE/multi-statement/pg_sleep/information_schema; forecast math matches fixtures
```

## T16 — compliance (acceptance, pending)

```bash
curl -s -X POST localhost:4000/api/v1/compliance/scan && sleep 5 && curl -s localhost:4000/api/v1/compliance/flags | jq '.[].risk_level' | sort | uniq -c
pnpm --filter @aegis/api test -- compliance   # evidence span must be verbatim; keyword/LLM disagreement → needs_review
```

## T17–T22 — web (acceptance, pending; verified by the Architect in Chrome)

```bash
pnpm --filter @aegis/web build               # exits 0, no type errors
# manual/Chrome: every route renders footer; theme toggle persists across reload; 360px width has no horizontal scroll;
# prism renders (WebGPU or 2D fallback message in console); halftone animates; glow input focus state; lighthouse a11y >= 90
```

## T23–T24 — demo + hardening (acceptance, pending)

```bash
pnpm demo                                    # runs the storyboard end-to-end in < 3 minutes, prints the metrics summary
AEGIS_CHAOS=llm_down pnpm sim payment_failed_3ds   # diagnosis degraded=true, action still bounded and proposed
pnpm test && pnpm typecheck && pnpm lint     # all green
git grep -nE 'sk-(ant|proj)|whsec_[A-Za-z0-9]{10,}' -- ':!*.md'   # no output (no secrets)
```
