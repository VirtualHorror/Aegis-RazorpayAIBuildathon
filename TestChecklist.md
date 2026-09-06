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
# ✅ cold-start interleaving regression: `projections.test.ts` 1 file / 9 tests passed, including B-007 order-slot reservation
#    `lockOrderSlot` inserts a NULL-customer placeholder before the customer upsert; the contended-burst probe is rerun with T8's worker wiring

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
# ✅ 5 tests passed: development + `x-aegis-chaos: llm_down` -> LlmUnavailableError('chaos_llm_down') with the provider
#    never invoked; the development mode is persisted on `process_event`; production + the same header -> provider
#    called normally and no chaos field; no header -> normal; and the store does not leak past the request.

# Worker boundary (B-009): the durable payload is re-entered before the orchestrator/LLM path.
pnpm --filter @aegis/api exec vitest run src/worker/process-event.test.ts
# ✅ 2 tests passed: `chaos: 'llm_down'` -> `chaos_llm_down` with zero provider calls; ordinary jobs remain unchanged.

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

## T7 — diagnostician (acceptance, verified 2026-09-05)

```bash
pnpm --filter @aegis/api exec vitest run src/diagnosis src/db/repos/diagnoses.test.ts --reporter verbose
# ✅ Test Files 5 passed (5) · Tests 38 passed (38), observed 2026-09-05 16:57 UTC
# ✅ six T5 fixtures through the stub (4 payment + pending/halted subscriptions), nested card PII masking,
#    every cross-check row with an audit note, unapplied-event skip, and a throwing-client fallback.
# ✅ repository integration round-trip reads numeric(4,3) confidence as number 0.9, not the driver string "0.900".

pnpm typecheck && pnpm test && pnpm lint
# ✅ run 1 (16:53 UTC): typecheck shared/api/web; shared 5 files / 47 tests; API 23 files / 128 tests; lint 3 projects.
# ✅ run 2 (16:54 UTC): typecheck shared/api/web; shared 5 files / 47 tests; API 23 files / 128 tests; lint 3 projects.
# ✅ run 3 (16:57 UTC): typecheck shared/api/web; shared 5 files / 47 tests; API 23 files / 128 tests; lint 3 projects.
#    The API package command is `vitest run --no-file-parallelism --maxWorkers=1` (D-047).

# A pre-fix root run with the unpinned `vitest run` command failed because schema migration hooks interleaved
# with worker/ingress files (`relation "jobs" does not exist` and contaminated duplicate assertions). The package
# script was pinned, then the focused suite and the three gates above were run without another test process.
```

### T7 re-run by Claude (verification, 2026-09-05)

```bash
pnpm --filter @aegis/api exec vitest run src/diagnosis src/db/repos/diagnoses.test.ts src/llm/mask.test.ts
# ✅ Test Files 6 passed (6) · Tests 44 passed (44) — includes Claude's two additions (B-010, C-A6 ordering)

pnpm typecheck && pnpm test && pnpm lint   # x3, each exit 0
# ✅ run 1/2/3: typecheck 3 projects; shared 5 files / 47 tests; api 23 files / 130 tests; lint 3 projects

# C-A7 acid test — mask the shape production actually produces (a `RETURNING *` payments row + CustomerRow),
# not a hand-written literal:
#   LEAK alice@example.com: false   LEAK customer@example.test: false
#   LEAK +919876543210: false       LEAK Aegis Test Customer: false
#   masked -> "email":"a••••@example.com" "contact":"+91••••••3210" "name":"A••••"
#   nested -> "notes":{"card":{"number":"••••••••••••1111"}}   (card.number/cvv/expiry_* masked at any depth)
# ❗ The same probe found B-010: every `Date` masked to `{}`. Fixed in mask.ts:78; regression test added.

# PostgreSQL numeric trap — proved the cast is load-bearing, not decorative:
psql -h localhost -U aegis -d aegis_test -tAc "SELECT pg_typeof(confidence) FROM diagnoses LIMIT 1"   # numeric
node -e "pool.query('SELECT confidence FROM diagnoses LIMIT 1')"
# ✅ RAW driver value: "0.900" | typeof: string   -> parseDiagnosisConfidence() is required, and
#    grep setTypeParser -> only apps/api/src/db/pg-types.ts:8 (OID 20 / int8). Nothing registers OID 1700.
#    Every read path (insert RETURNING, get, list, latest) funnels through mapDiagnosisRow.

# C-A6 — the model call is outside every transaction, proved rather than asserted:
#   `Diagnostician.db` is typed `Pool` (diagnostician.ts:76), so a `PoolClient` cannot be injected;
#   new test "completes the model call before any database work and never opens a transaction (C-A6)"
#   records a trace from a fake pool -> ✅ ['llm', 'sql:INSERT'], no BEGIN.
#   Non-vacuous: flipping the expectation to ['sql:INSERT', 'llm'] -> 1 failed. Restored.

# D-045 — grep for a second definition of the contract:
grep -rn "ROOT_CAUSES\s*=\|STRATEGIES\s*=\|DiagnoseOutputSchema\s*=" apps/api/src packages/
# ✅ one definition (llm/prompts/index.ts:21,33,43); stub-fixtures.ts:12-13 and diagnosis/schema.ts re-export only.
```

## T8 — orchestrator (acceptance, green 2026-09-05)

```bash
pnpm --filter @aegis/api exec vitest run src/orchestrator src/guardrails src/bus src/modules/checkout-recovery test/orchestrator.integration.test.ts src/orchestrator/projections/projections.test.ts test/chaos.integration.test.ts src/worker/process-event.test.ts --no-file-parallelism --maxWorkers=1
# ✅ Test Files 10 passed (10) · Tests 41 passed (41)
#    deterministic routing, module call order, null-proposal guard omission, kill switch, cooldown/quiet-hours/budget,
#    prior_failures_24h wiring, duplicate action idempotency, advisory serialization, audited execution, SSE framing,
#    B-007 order-slot reservation, and B-009 durable chaos payload/re-entry.

pnpm --filter @aegis/api exec vitest run src/orchestrator/projections/projections.test.ts --no-file-parallelism --maxWorkers=1
# ✅ Test Files 1 passed (1) · Tests 9 passed (9) — cold-start order/payment interleaving has no deadlock.

pnpm --filter @aegis/api exec vitest run test/chaos.integration.test.ts src/worker/process-event.test.ts --no-file-parallelism --maxWorkers=1
# ✅ request persistence/production gate and worker re-entry tests passed (5 + 2 tests); invalid values never enable chaos.

pnpm typecheck && pnpm test && pnpm lint                         # x3, serially
# ✅ run 1: typecheck 3 projects; shared 5 files / 47 tests; API 31 files / 160 tests; lint 3 projects.
# ✅ run 2: typecheck 3 projects; shared 5 files / 47 tests; API 31 files / 160 tests; lint 3 projects.
# ✅ run 3: typecheck 3 projects; shared 5 files / 47 tests; API 31 files / 160 tests; lint 3 projects.
curl -N localhost:4000/api/v1/stream         # `: ping` heartbeat every 15s; committed events appear when sim runs
```

## T9 — CheckoutRecovery (acceptance, green 2026-09-05)

```bash
pnpm --filter @aegis/api exec vitest run src/modules/checkout-recovery/index.test.ts src/modules/checkout-recovery/templates.test.ts src/modules/checkout-recovery/links.test.ts --no-file-parallelism --maxWorkers=1
# ✅ Test Files 3 passed (3) · Tests 9 passed (9): locale/template selection (including Hindi), deterministic daily
#    retry links, masked WhatsApp payload schema, positive-amount/strategy/opt-out guards, and payment idempotency.
# ✅ The three serial full gates recorded in §T8 also passed (API 31 files / 160 tests; shared 5 files / 47 tests).
```

### T8/T9 re-run by Claude (verification, 2026-09-05) — GREEN

```bash
pg_isready                                   # /var/run/postgresql:5432 - accepting connections
pnpm db:status                               # applied: 0001_init, 0002_readonly_grants, 0003_projection_guards; pending: (none)

pnpm --filter @aegis/api exec vitest run src/orchestrator src/guardrails src/bus src/modules/checkout-recovery \
  test/orchestrator.integration.test.ts test/chaos.integration.test.ts src/worker/process-event.test.ts \
  --no-file-parallelism --maxWorkers=1
# ✅ Test Files 10 passed (10) · Tests 41 passed (41)

pnpm typecheck && pnpm test && pnpm lint
# ✅ exit 0 — typecheck 3 projects; shared 5 files / 47 tests; API 31 files / 160 tests; lint 3 projects
```

Code review performed alongside the run (no changes were required):

- **B-007 lock order.** `shared.ts:lockOrderSlot` (`apps/api/src/orchestrator/projections/shared.ts:96`) locks an existing
  order, else inserts a NULL-customer placeholder, else re-locks the concurrent winner — so the order identity is always
  reserved *before* `projectCustomer`. Per-entity sequences match the single global C-C3 order (entity's own row first,
  then toward the FK root): `payments:68 → orders:82 → customers:83`, `orders:62 → customers:69`,
  `disputes:91 → payments:100`, `subscriptions:69 → customers:75`, `invoices:71 → customers:77`. No path inverts it, so
  no ABBA cycle exists. The regression at `projections.test.ts:247` is non-vacuous: `waitForLockWait` throws unless a
  connection is genuinely blocked on a `Lock` wait event.
- **B-009 chaos re-entry.** `processEventHandler` (`apps/api/src/worker/process-event.ts:59`) wraps the whole handler in
  `runProcessEventWithChaos` → `runWithLlmChaos`, and the orchestrator call at `:73` (which owns the only diagnostician
  path) runs inside that AsyncLocalStorage context. `chaosFromJobPayload` accepts only the literal `llm_down`, and
  `reconciler.ts:55` persists `chaos` only for that literal, so production job payloads stay `{ eventId }` (C-D5).
- **No LLM inside locks.** The only transaction sites in the API are `EventOrchestrator` (projection / event status /
  proposal persistence), `execute.ts` (two short `withClientTransaction` phases *around* `module.execute`),
  `reconciler.ts`, `process-event.ts`, `db/tx.ts` and `db/migrate.ts`. `Diagnostician.diagnose` opens no transaction and
  calls `insertDiagnosis` on the pool *after* the model call; `EventOrchestrator.ts:117-129` commits the projection
  before diagnosing. Zero LLM calls hold a row lock (C-A2/C-A6).

## T10–T12 — modules (T10, T11 and T12 green)

```bash
pnpm --filter @aegis/api test -- modules
# checkout_recovery: locale → template; cooldown blocks 2nd message; opted_out blocks
# subscription_salvager: transition table exhaustive; retry_count stops at max; recovered on charged
# b2b_negotiator: offer never below floor or above max pct; round 4 → escalated; > limit → pending_approval
# chargeback_evidence: packet contains all sections; review_status requires_human_review; never auto-submitted
pnpm sim all && psql $DATABASE_URL -c "select module,status,count(*) from actions group by 1,2 order by 1,2"
```

T10 focused command: `pnpm --filter @aegis/api exec vitest run src/modules/subscription-salvager --no-file-parallelism --maxWorkers=1` -> 2 files / 6 tests passed.

T11 focused command: `pnpm --filter @aegis/api exec vitest run src/modules/b2b-negotiator --no-file-parallelism --maxWorkers=1` -> 3 files / 7 tests passed; integer-paise floor/max-pct clamps, exhaustive state transitions, approval threshold, masked model input, and model-number fallback.

T12 focused command: `pnpm --filter @aegis/api exec vitest run src/modules/chargeback-evidence --no-file-parallelism --maxWorkers=1` -> 2 files / 4 tests passed; deterministic packet assembly, honest missing delivery, masked IDs, proposal hook persistence, and approval-gated submission.

## T13 — approvals + ledger + metrics (verified 2026-09-05)

```bash
curl -s localhost:4000/api/v1/approvals | jq length                  # > 0 after sim
curl -s -X POST localhost:4000/api/v1/actions/<id>/decision -d '{"decision":"approve","note":"ok","actor":"human:nabhanyu"}'  # 200, status executed
curl -s localhost:4000/api/v1/metrics/summary | jq                    # money_recovered_paise, discounts_granted_paise, dedupe counts, llm degraded %

```

Observed on 2026-09-05:

```text
pnpm --filter @aegis/api exec vitest run test/approvals.integration.test.ts src/orchestrator --no-file-parallelism --maxWorkers=1
Test Files  3 passed (3)
Tests  15 passed (15)
pnpm --filter @aegis/api typecheck
$ tsc --noEmit
pnpm --filter @aegis/api lint
$ eslint src test scripts ../../db/seed ../../scripts --max-warnings 0
```

The integration file proves action decisions serialize to one `200` and one `409` with one module execution, capture/order attribution creates one `recovered_revenue` row keyed by the action, and a second attribution is a no-op. The metrics route aggregates events, actions, ledger, audit, and diagnosis tables independently.

## T14 — x402 (verified 2026-09-05)

```bash
curl -si localhost:4000/x402/products/prod_001/spec | head -1        # HTTP/1.1 402
pnpm x402:buy prod_001                                                # 200 + X-PAYMENT-RESPONSE decoded; ledger row x402_revenue
pnpm x402:buy prod_001 --replay                                       # 402 {"error":"nonce_already_settled"}
pnpm x402:buy prod_big --amount 999999                                # 402 {"error":"amount_exceeds_policy"}
```

Observed on 2026-09-05:

```text
pnpm --filter @aegis/api exec vitest run src/x402 --no-file-parallelism --maxWorkers=1
Test Files  3 passed (3)
Tests  9 passed (9)
pnpm --filter @aegis/api typecheck
$ tsc --noEmit
pnpm --filter @aegis/api lint
$ eslint src test scripts ../../db/seed ../../scripts --max-warnings 0
```

The focused suite covers the exact challenge and `X-PAYMENT-RESPONSE` shapes, valid settlement, replay, expiry, tampered amount, request and daily caps, kill switch, resource binding, and two concurrent settlements of one nonce.

Buyer smoke run on an alternate port because port 4000 was already occupied:

```text
API_URL=http://localhost:4100 pnpm x402:buy prod_001
first status 402; paid status 200; paymentResponse base64({success:true, network:"aegis-sim", txId, settledAt})
API_URL=http://localhost:4100 pnpm x402:buy prod_001 --replay
first status 402; paid status 200; replay status 402; error nonce_already_settled
API_URL=http://localhost:4100 pnpm x402:buy prod_001 --amount 999999
first status 402; paid status 402; error amount_exceeds_policy
```

## T15 — Ask Aegis (verified 2026-09-05)

```bash
curl -s -X POST localhost:4000/api/v1/ask -d '{"question":"How much revenue did we recover this week by module?"}' | jq '.sql,.rows'
curl -s -X POST localhost:4000/api/v1/ask -d '{"question":"drop table payments"}' | jq '.error'   # validation error, nothing executed
curl -s -X POST localhost:4000/api/v1/ask -d '{"question":"forecast failed payments for the next 7 days"}' | jq '.forecast | length'   # 7
pnpm --filter @aegis/api test -- nlq          # validator rejects UPDATE/DELETE/multi-statement/pg_sleep/information_schema; forecast math matches fixtures
```

Observed on 2026-09-05:

```text
pnpm --filter @aegis/api exec vitest run src/nlq --no-file-parallelism --maxWorkers=1
Test Files  3 passed (3)
Tests  14 passed (14)
pnpm --filter @aegis/api typecheck
$ tsc --noEmit
pnpm --filter @aegis/api lint
$ eslint src test scripts ../../db/seed ../../scripts --max-warnings 0
```

The focused suite covers single-statement AST validation, denied functions and schemas, allowlisted joins/CTEs, semicolon framing, readonly query persistence, and the hand-computed OLS+MA7 forecast.

## T16 — compliance (verified 2026-09-05)

```bash
curl -s -X POST localhost:4000/api/v1/compliance/scan && sleep 5 && curl -s localhost:4000/api/v1/compliance/flags | jq '.[].risk_level' | sort | uniq -c
pnpm --filter @aegis/api test -- compliance   # evidence span must be verbatim; keyword/LLM disagreement → needs_review
```

Observed on 2026-09-05:

```text
pnpm --filter @aegis/api exec vitest run src/compliance --no-file-parallelism --maxWorkers=1
Test Files  3 passed (3)
Tests  9 passed (9)
pnpm --filter @aegis/api typecheck
$ tsc --noEmit
pnpm --filter @aegis/api lint
$ eslint src test scripts ../../db/seed ../../scripts --max-warnings 0
```

The focused suite covers the fixed rubric and keyword vocabulary, case-sensitive evidence verification, keyword/model disagreement, malformed and unavailable model fallbacks, and concurrent scans producing one flag per product/run.

## Sprint 2 verification — T10–T16 (Claude, 2026-09-06)

Lightning verification of the batched sprint (D-052). Two questions were asked of every changed file: *is every migration uniquely numbered with a down file?* and *does any transaction that holds `SELECT … FOR UPDATE` ever wait on a model call?*

```text
$ ls db/migrations
0001_init.sql  0002_readonly_grants.sql  0003_projection_guards.sql  0004_ledger_unique.sql   (+ matching .down.sql for each; no duplicate prefix)

$ grep -rn "FOR UPDATE" apps/api/src --include=*.ts | grep -v .test. | wc -l
30      # every site inspected; the lock-holding transactions in the new modules are:
        #   compliance/scanner.ts:113-142   BEGIN → pg_advisory_xact_lock → FOR UPDATE → UPDATE/INSERT → COMMIT   (model call at :63, before BEGIN)
        #   compliance/routes.ts:47-58      status transition + audit                                                (no model call)
        #   orchestrator/attribution.ts:38   ledger credit under actions FOR UPDATE                                    (no model call)
        #   x402/facilitator.ts:24           nonce FOR UPDATE, HMAC verify in TypeScript                               (no model call)
        #   routes/approvals.ts:126,161      evidence review / guardrail update                                        (no model call)
        #   modules/subscription-salvager/index.ts:132-164  dunning retry; COMMIT precedes handleSynthetic            (no model dependency)
        # model calls: b2b-negotiator/index.ts:106 and chargeback-evidence/index.ts:49 run in propose() from
        # EventOrchestrator.runActionPath (pool, no open transaction); nlq/service.ts:110,149,175 run before
        # executeReadonly opens the readonly transaction.

$ pg_isready
/var/run/postgresql:5432 - accepting connections
$ pnpm typecheck && pnpm test && pnpm lint      # exit 0
packages/shared test:  Test Files  5 passed (5)   Tests  47 passed (47)
apps/api test:         Test Files 48 passed (48)  Tests 210 passed (210)
lint: packages/shared, apps/api, apps/web — Done
```

Verdict: **GREEN** for T10, T11, T12, T13, T14, T15, T16. Tags `task-10-done` … `task-16-done` moved to the verification commit.

## T17–T22 — web (acceptance, pending; verified by the Architect in Chrome)

```bash
pnpm --filter @aegis/web build               # exits 0, no type errors
# manual/Chrome: every route renders footer; theme toggle persists across reload; 360px width has no horizontal scroll;
# prism renders (WebGPU or 2D fallback message in console); halftone animates; glow input focus state; lighthouse a11y >= 90
```

### T17 — web shell (observed 2026-09-06, Claude)

```text
$ pnpm --filter @aegis/web build
▲ Next.js 16.3.4 (Turbopack)
✓ Compiled successfully in 3.1s
  Finished TypeScript in 3.5s
✓ Generating static pages using 3 workers (11/11)
Route (app): ƒ /   ○ /_not-found /actions /approvals /ask /compliance /events /kitchen-sink /settings /x402

$ pnpm --filter @aegis/web lint          # eslint --max-warnings 0 → clean
$ pnpm --filter @aegis/web typecheck     # next typegen && tsc --noEmit → ✓ Types generated successfully
$ pnpm --filter @aegis/web test
 Test Files  2 passed (2)      Tests  8 passed (8)      # lib/format.test.ts, lib/sse.test.ts

$ pnpm --filter @aegis/api exec vitest run src/routes/system.test.ts src/bus --no-file-parallelism --maxWorkers=1
 Test Files  2 passed (2)      Tests  3 passed (3)      # /api/v1/system now returns env, version, simulated
$ pnpm --filter @aegis/shared test        # 5 files / 47 tests (BUS_EVENT_NAMES moved here, D-059)

$ curl -s localhost:4000/api/v1/system
{"provider":"openai","model":"gpt-5.6","modelFast":"gpt-5.4-mini","env":"development","version":"0.1.0","simulated":true}
$ curl -s localhost:3000/events | grep -o "Made with 💖 by Nabhanyu for Razorpay AI Buildathon"
Made with 💖 by Nabhanyu for Razorpay AI Buildathon
```

Chrome (claude-in-chrome, 1478px window, then a 360px same-origin iframe because the window manager refused a 360px resize):

- `/kitchen-sink`: every component renders in the current theme and in the forced opposite theme (`.light`/`.dark` wrapper, token-only components).
- Theme toggle → Light: `<html class="light" style="color-scheme: light">`, `localStorage.theme = "light"`; unchanged after reload (no flash: next-themes script runs before hydration).
- Top bar reads the live API: `LOCAL · SIM`, `openai · gpt-5.6`, `Kill switch off`, `Live` (SSE socket open).
- GlowInput: focus tints the border and intensifies the halo; `Tab` on the empty box fills the example question; `Enter` submits (toast shown); loading state shows the spinner.
- Drawer: opens over the page, `Escape` closes it, focus returns to the "Drawer" button, body scroll lock removed (`document.body.style.overflow === ""`).
- Toast region is `role="status" aria-live="polite"`; a pushed toast appears bottom-right and dismisses.
- 360px: `document.documentElement.scrollWidth = 342 ≤ innerWidth = 357` (no horizontal page scroll), `<aside>` is `display: none`, the fixed bottom bar shows the eight icon targets, the events table scrolls inside its card, the footer sits above the bottom bar.

Found and fixed during the check: KPI rupee amounts clipped at 28px in narrow tiles (now `clamp(18px, 11cqi, 28px)` with a container query); the Tab hint overlapped long placeholders (textarea gets right padding while the hint shows); a grid with an implicit `auto` track let the kitchen-sink table push the page wider than 360px (`grid-cols-1` = `minmax(0, 1fr)`); the textarea did not grow after a programmatic fill (`field-sizing: content`).

### T18 — overview + events (observed 2026-09-06, Claude)

```text
$ pnpm --filter @aegis/web test
 Test Files  5 passed (5)      Tests  22 passed (22)
   # lib/events.test.ts (stream → row merge, paging, search), lib/overview.test.ts (counter bumps, recent list, module activity),
   # components/fx/halftone.test.ts (field bounds, pinpoints at intensity 0, merged cells at 1, one cell per pitch square)
$ pnpm --filter @aegis/web lint && pnpm --filter @aegis/web typecheck      # clean
$ pnpm --filter @aegis/api exec vitest run test/approvals.integration.test.ts src/routes --no-file-parallelism --maxWorkers=1
 Test Files  2 passed (2)      Tests  7 passed (7)                          # B-012 cursor paging, B-013 call counting
$ curl -s 'localhost:4000/api/v1/metrics/summary?window=24h' | jq .llm
{"calls":18,"degraded":18,"degraded_rate":1,"avg_latency_ms":0,"by_provider":{"fallback":18}}
```

Chrome (1478px window; 360px via same-origin iframe):

- `/`: prism hero with the seven module rays and labels; KPI tiles, money strip, recent actions and model health rendered from `GET /api/v1/metrics/summary?window=24h` and `GET /api/v1/actions?limit=8`; window switcher 24 h / 7 days / All time refetches (content dims while pending).
- Top-bar **Run demo** → `POST /api/v1/sim/run {scenario:'all'}` → toast "Demo sent 14 webhooks · 12 accepted, 0 duplicate, 1 rejected, 1 ignored · p95 18 ms". Within a second: `/events` prepended 14 rows ("just now", rail flash, `unverified:…` row with signature ✗), the listening panel's halftone pulsed to full intensity and decayed; `/` moved to 1,917 events, 6 executed, 15 blocked (`quiet_hours_local` at 01:40 IST), 21 proposed, recent actions filled with module badges, prism labels lit per module.
- Event drawer: raw payload JSON with copy, diagnoses (root cause, strategy, confidence, provider, degraded badge), actions with links; Escape closes and returns focus.
- Filters: type/status change the URL (`/events?type=…&status=…`) and re-render the first page on the server; the compact glow search narrows loaded rows client-side.
- 360px: `/events` shows 50 cards (`ul.sm:hidden`), `/` stacks the hero copy above the picture; both `scrollWidth 342 ≤ innerWidth 357`.

Found and fixed: relative times could read "in the future" because the shared 10 s clock lagged a fresh event (now "just now" for skews under a minute); the listening panel text was unreadable over the dots (gradient scrim); B-012 and B-013 above; `Date.now()` during render (React purity rule) replaced by `useNow()`.

### T19 — actions + approvals (observed 2026-09-06, Claude)

```text
$ pnpm --filter @aegis/web test
 Test Files  6 passed (6)      Tests  27 passed (27)          # + lib/actions.test.ts
$ pnpm --filter @aegis/api exec vitest run src/orchestrator/projections/projections.test.ts src/modules/b2b-negotiator --no-file-parallelism --maxWorkers=1
 Test Files  4 passed (4)      Tests  17 passed (17)          # + merchantFloorPaise (B-014)
$ curl -s localhost:4000/api/v1/approvals | jq '{actions: (.actions|length), evidence: (.evidence|length)}'
{"actions": 1, "evidence": 3}
$ curl -s 'localhost:4000/api/v1/actions?limit=1' | jq '.items[0] | {module, status, diagnosis_provider, diagnosis_degraded}'
{"module": "b2b_negotiator", "status": "pending_approval", "diagnosis_provider": null, "diagnosis_degraded": null}
```

Chrome (768px window plus a 1440px same-origin iframe for the desktop layout):

- `/actions`: 24 rows, module colour rails, status pills, ₹ impact and expected recovery, and a diagnosis column reading `openai`, `degraded` or `rules only` per row. Status and module selects drive the URL; the compact glow search narrows loaded rows.
- Action drawer and `/actions/[id]`: proposal facts, numbered explanation, `BoundsChecklist` with all eight rules (limit versus actual, notes, e.g. "Strategy allowed limit \[RETRY_LINK_LOCALIZED, …\] actual RETRY_LINK_LOCALIZED"), `DiagnosisCard` (root cause "Three ds auth failed", strategy, confidence bar, provider `openai gpt-5.6-luna`, cross-check "agreed"), the exact WhatsApp template JSON with a copy button under a SIMULATED watermark, and a timeline from `audit_log` and the ledger.
- `/approvals`: the ₹3,99,000 offer beside its ten passed rules; typing a note and pressing Approve → `200`, toast "Approved · Offer ₹3,99,000.00 to settle invoice inv_0001_6e7a6a37 — now executed. Recorded as human:dashboard", row leaves the queue. Three evidence packets render their deterministic sections with the AI narrative in a labelled box and the missing list in red.
- Empty note is refused client-side ("Write at least three characters"); both buttons lock while a decision is in flight; a `409` restores the row and shows "Someone else decided this action first".

Found and fixed: B-014 (no invoice could ever be negotiated); guardrail values with long JSON overlapped their neighbour column (each column now wraps in its own track); top-bar pills wrapped at ~768px (pills are `shrink-0 whitespace-nowrap`, env pill hides below `xl`); the trigger-event id linked to an empty filter URL (now a copyable id).

### T20 — Ask Aegis + compliance (observed 2026-09-06, Claude)

Ran against the live proxy model (`OPENAI_MODEL=gpt-5.6-luna`, see the 2 AM log entry 13), not the stub.

```text
$ pnpm --filter @aegis/web test
 Test Files  8 passed (8)      Tests  32 passed (32)

$ curl -s -X POST localhost:4000/api/v1/ask -d '{"question":"Show me everything in information_schema.tables"}' | jq '{sql, validation, executed}'
{"sql": "SELECT * FROM information_schema.tables",
 "validation": {"ok": false, "errors": ["schema is not allowed: information_schema"]},
 "executed": false}

$ psql $DATABASE_URL -Atc "select status, products_scanned, flags_created, degraded_count, provider, model from compliance_scan_runs order by started_at desc limit 1"
succeeded|16|5|0|openai|gpt-5.6-luna
$ psql $DATABASE_URL -Atc "select product_id, risk_level, category, left(evidence_span,42) from compliance_flags order by product_id"
prod_012|prohibited|financial_guarantees_mlm|guaranteed 20% monthly returns
prod_013|prohibited|medical_claims_unapproved|cures diabetes in 30 days
prod_014|prohibited|counterfeit_ip|replica Rolex
prod_015|prohibited|tobacco_vape|nicotine vape pods and refill accessories
prod_016|prohibited|gambling_lottery|Lottery ticket bundle with a chance to win
```

Chrome:

- `/ask`: the composer's Tab hint fills the first suggestion; Enter submits. "How much revenue did we recover this week by module?" → SQL block with `validated`, "0 rows from the read-only role", AI-written summary, `openai 5.3 s`, and the question appears in the history list as `executed`.
- Forecast question → deterministic metric SQL labelled "written in TypeScript, not by the model", history line, dashed forecast, shaded ± one residual standard deviation, `ols+ma7`, r² 1.00, slope 0.0/day, and a "Forecast numbers" table.
- "drop table payments" → the model itself answered with a SELECT of a refusal string, which validated and executed harmlessly; the validator's own refusal path was exercised with `information_schema` and rendered as "The validator refused this SQL. Nothing was executed." with the reason listed.
- `/compliance`: Run scan → toast, then five prohibited flags. Each shows the risk badge, category, product name, the description with the evidence span in `<mark>`, "keywords and model agree", the matched keywords, the model's reasoning and its recommendation. Acknowledge → card updates in place to "Acknowledged · Last set by human:dashboard".

Found and fixed: B-015 (crash on Acknowledge, and no product copy on any card); empty-state text was unreadable over the halftone (radial scrim of the card surface); vitest could not resolve the `@/` alias once a test imported a component (alias added to `vitest.config.mts`).

### T21 — x402 Lab, settings and entity views (observed 2026-09-06, Claude)

```text
$ pnpm --filter @aegis/api exec vitest run test/approvals.integration.test.ts --no-file-parallelism --maxWorkers=1
 Test Files  1 passed (1)      Tests  10 passed (10)
   # + x402 signing helper (challenge → sign → 200 → replay 402, secret absent from the response)
   # + guardrail history route, + system.kill_switch publish (B-017)
$ pnpm --filter @aegis/api exec vitest run test/app.test.ts --no-file-parallelism --maxWorkers=1
 Test Files  1 passed (1)      Tests  7 passed (7)      # + CORS methods/exposed headers (B-016)
$ pnpm --filter @aegis/web test
 Test Files  9 passed (9)      Tests  36 passed (36)    # + lib/guardrails.test.ts

$ curl -si -X OPTIONS localhost:4000/api/v1/guardrails/max_discount_pct -H "Origin: http://localhost:3000" -H "Access-Control-Request-Method: PUT" | grep -i allow-methods
access-control-allow-methods: GET, HEAD, POST, PUT, OPTIONS
$ curl -si localhost:4000/health -H "Origin: http://localhost:3000" | grep -i expose
access-control-expose-headers: X-PAYMENT-RESPONSE
```

Chrome:

- `/x402`, three clicks: **402** with `maxAmountRequired 49900`, `payTo merchant_aegis_demo` and a nonce that expires in a minute; **200** returning the product spec with the decoded `X-PAYMENT-RESPONSE` (`success: true`, `network: aegis-sim`, `txId`, `settledAt`); **402 `nonce_already_settled`** on replay. The settlement table then held five rows including the new `Settled` one and an older `Rejected · Amount exceeds policy`. The signed header is shown as the base64 string the browser sent, and the caps panel read ₹1,000 per request, ₹5,000 per payer per day, ₹1,497 settled today.
- `/settings`: `120` in Maximum discount was refused before any request ("Enter a percentage between 0 and 100"); `12` saved and the field read "Stored: 12 · last set by human:dashboard"; the kill switch asked "Stop every module?" in a custom dialog (never `window.confirm`), turned the card red, turned the top-bar pill red **live over SSE**, and wrote `true → false` into the change history under `human:dashboard` when resumed.
- `/subscriptions` and `/invoices` render state, salvage/negotiation state, amounts and the invoice floor.

Found and fixed: B-016 (CORS blocked every guardrail PUT and hid the payment response header), B-017 (kill-switch changes never reached the bus), and the settings change history refreshed the guardrails instead of the audit trail.

### T22 — prism hero, polish and accessibility (observed 2026-09-06, Claude)

```text
$ pnpm --filter @aegis/web test
 Test Files  11 passed (11)     Tests  45 passed (45)
   # + components/prism/prismGeometry.test.ts, components/prism/prismUniforms.test.ts

$ npx vgpu check src/components/prism/prism.wgsl        # run from apps/web
"diagnostics": []                                        # parses, reflection lists the `params` uniform
"validation": { "attempted": true, "ok": false, "skipped": { "code": "VGPU-WGSL-VALIDATE-NO-DEVICE" } }
   # no WebGPU adapter on this VM (DV-010); the browser is the real check and it was run

$ pnpm --filter @aegis/web build
✓ Compiled successfully — 13 routes
```

Chrome (claude-in-chrome for interaction, chrome-devtools for Lighthouse):

- `/`: the prism renders, the entry beam follows the pointer and the fan sweeps with it, and the legend lights per module when a bus event arrives. `navigator.gpu` exists in this browser but `requestAdapter()` returns null, so `PrismWebGPU` fell back to `PrismCanvas2D` and logged `[aegis] WebGPU prism unavailable, using the Canvas 2D renderer: navigator.gpu.requestAdapter() returned null` — the C-F4 fallback proven live rather than argued.
- Run demo while watching the hero: "Demo sent 14 webhooks … p95 69 ms", counters moved 1,922 → 1,930 → 1,934 events and 9 → 13 actions, and the KPI tiles flashed.
- 360px (same-origin iframe): `scrollWidth 342 ≤ innerWidth 357`, the hero copy stacks above the picture, the canvas keeps its 960:280 aspect, the bottom bar shows the eight targets.

Lighthouse (navigation mode):

| Page | Device | Accessibility | Failed audits |
|---|---|---|---|
| `/` | desktop | 100 | 0 |
| `/events` | mobile | 100 | 0 |
| `/approvals` | mobile | 100 | 0 |
| `/x402` | mobile | 100 | 0 |

Found and fixed: B-018 (white on the dark-mode accent measured 3.13:1 — `/` scored 96 before the `--on-accent` token); the x402 stepper used `h3` under no `h2`, breaking heading order (`/x402` scored 99 before it became a paragraph); and five React purity/ref errors the linter caught in the renderers (refs are now written in effects, and the renderer choice comes from `useSyncExternalStore`).

## T23 — demo storyboard, README, video plan (verified 2026-09-06)

```bash
pnpm dev                                     # both servers must already be up; demo.sh starts nothing
bash scripts/demo.sh                         # the storyboard, narrated
bash scripts/demo.sh --fast --no-seed        # no pauses, keep current data
bash scripts/demo.sh --allow-quiet-hours     # widen quiet_hours_local via the public API, restored on exit
AEGIS_CHAOS=llm_down pnpm sim payment_failed_3ds_intl   # diagnosis degraded=true, action still bounded
```

Observed (2026-09-06): the run completes in **1:46**, under the three-minute budget, with every read-back scoped to
the current run (B-021):

```text
 STEP  1/13 [0:02]  Reset the demo data          → guardrails back to ₹2,000 / 15% / quiet hours 21:00–08:00
 STEP  2/13 [0:07]  Start the catalog scan       → 202 queued, 16 products, read back at step 11
 STEP  3/13 [0:09]  3DS decline ×4               → totals accepted=1 duplicate=3
 STEP  6/13 [0:22]  B2B invoice expires          → discount_offer: blocked · ₹21000.00 · daily_discount_budget_paise
 STEP  7/13 [0:52]  Chargeback opened            → evidence_packet: pending_approval · ₹0.00
 STEP  8/13 [1:13]  x402 purchase                → 402 challenge → 200 + X-PAYMENT-RESPONSE
 STEP  9/13 [1:17]  Replay the same header       → 402 nonce_already_settled
 STEP 10/13 [1:22]  Retry captured               → recovery action executed: whatsapp_cart_nudge, 79900 paise
 STEP 13/13 [1:31]  AEGIS_CHAOS=llm_down         → diagnoses.degraded = t, provider = fallback, action still executed
 Demo complete in 1:46.
```

Attribution, which had never once fired before this task (B-019):

```text
psql -c "select account, count(*), sum(credit_paise) from ledger_entries group by account"
 recovered_revenue |  1 |  79900        ← first ever; rises 79 900 per run (159800 → 239700 → 319600)
 x402_revenue      | 10 | 549000
```

Guardrail restored by the trap after `--allow-quiet-hours`:

```text
{"key":"quiet_hours_local","value":{"end":8,"start":21},"updated_by":"demo-script"}
```

New simulator surface (`apps/api/test/sim-cli.test.ts`, 11 tests, red-green proved):

```bash
pnpm sim --help                              # lists --order/--customer/--created-at and the AEGIS_CHAOS alias
pnpm x402:buy prod_001 --payer probe --replay   # 402 → 200 (paymentResponse) → 402 nonce_already_settled
```

Artifacts: `scripts/demo.sh`, `README.md` (with "What Broke at 2 AM & How I Got Out"),
`docs/video-storyboard.md`, `docs/architecture.svg`.

## T24 — hardening (verified 2026-09-06)

### 24.1 Security pass against `Constraints.md` §D

Every line re-verified against the running system, not the source alone.

| Rule | Command | Result |
|---|---|---|
| **C-D1** no `===` on signatures | `grep -rn timingSafeEqual apps/api/src` | `ingress/signature.ts:13` and `x402/canonical.ts:15`, both length-checked then `timingSafeEqual`; no `===` comparison on any signature |
| **C-D2** raw bytes | read `ingress/signature.ts` | `computeSignature(raw: Buffer, …)`; the ingress never re-serialises the body |
| **C-D3** no secrets | `git grep -nE 'sk-(ant\|proj\|live)\|whsec_[A-Za-z0-9]{10,}\|xoxb-\|AKIA[0-9A-Z]{16}' -- ':!*.md'` | no matches. `git check-ignore .env` → `.gitignore:6`; `git log --all -- .env` → empty (never committed). Every `postgres://user:pass@` hit is a test placeholder (`pw`, `test`) |
| **C-D4** PII redaction | `pnpm --filter @aegis/api exec vitest run test/app.test.ts` | **found a gap (B-023):** `card.number` was missing and a top-level `{ email }` would have logged in clear. `LOG_REDACT_PATHS` now covers every named field at both depths; 9 tests pass |
| **C-D5** no dev routes in production | `NODE_ENV=production tsx src/server.ts` on :4111 | `POST /api/v1/sim/run` → **404**, `POST /api/v1/sim/x402-sign` → **404**; the same routes on the development instance → **200** / **400** |
| **C-D6** no external BaaS | grep every `package.json` and all source for supabase/firebase/upstash/redis/bullmq/planetscale/mongodb | no dependency, no reference |
| **C-D7** read-only role excludes PII | live probes as `aegis_readonly` | `select email from customers` → **`permission denied for table customers`**; `insert` → **`cannot execute INSERT in a read-only transaction`**; `select count(*) from customers` → 1711. Granted columns are `country, created_at, id, locale, opted_out, updated_at` only — `name`/`email`/`contact` are absent, as are `payments.email`/`contact`. Role config: `default_transaction_read_only=on, statement_timeout=5s, idle_in_transaction_session_timeout=10s` |
| rate limit | 660 concurrent `GET /x402/catalog` | exactly `600 × 200` then `60 × 429`, with `x-ratelimit-limit: 600`, `x-ratelimit-remaining: 0`, `retry-after: 58` |

### 24.2 Failure drills

**LLM down.** `AEGIS_CHAOS=llm_down pnpm sim payment_failed_3ds_intl` (the env alias added in T23):

```text
diagnoses:  degraded = t, provider = fallback, strategy = RETRY_LINK_LOCALIZED
actions:    whatsapp_retry_link | executed        ← still bounded, still audited (C-A4)
```

**Database connections severed with work in flight.** `sudo systemctl restart postgresql` is not available to the agent
(DV-001: privileged steps belong to the human), so the closest equivalent was run instead: every API and worker
connection terminated with `pg_terminate_backend` while **242 jobs were in flight**.

```text
terminated 6 backends
/health immediately after   {"status":"ok","db":"ok","db_latency_ms":17}      ← pool healed, API never went down
jobs before  queued 264 | running 4 | succeeded 2062   total 2330  dead_letter 0
jobs after   queued 259 | running 4 | succeeded 2067   total 2330  dead_letter 0
```

No job lost, no job duplicated, work continued through the outage. **The accounting is what found B-022**: one row
sat at `attempts=7` against its own `max_attempts=5`.

**Duplicate storm — depth.** One event delivered 201 times:

```text
totals accepted=1 duplicate=200 rejected=0 ignored=0 rate_limited=0
webhook_events: evt_0001_a9f580fe | received | signature_valid=t | duplicate_count=200
jobs enqueued for it: 1                     ← counted, never re-processed (C-C2)
```

**Duplicate storm — breadth.** 80 distinct events × 5 duplicates on a clean instance against `aegis_test`:

```text
totals accepted=80 duplicate=220 rejected=0 ignored=0 rate_limited=180
burst verification jobs=80/80 succeeded=80 max_attempts=1 contended=false
aegis_test: 83 events | 220 duplicates | 83 processed | all jobs succeeded, max_attempts 1
```

The checklist's `--burst 200 --dupes 5` is 1 200 deliveries against a 600/minute limiter and 200 model calls; it was
run first and failed closed on both counts, which is the simulator behaving correctly (2 AM log #21).

**Kill switch (C-B5).** Flipped through the public API, then lifted:

```text
PUT /api/v1/guardrails/kill_switch {"value":true}  → updated_by t24-drill
module action     whatsapp_retry_link | blocked | kill_switch
  bounds row      {"rule":"kill_switch","limit":false,"actual":true,"pass":false,
                   "note":"all action modules are disabled by the merchant"}
x402 paid request 503 gateway_paused          ← the 402 price quote is still served (D-076)
PUT {"value":false} → gateway settles again immediately, 200 + X-PAYMENT-RESPONSE
```

### `Rollback.md` levels L0–L5, verified

| Level | Evidence |
|---|---|
| **L0** kill switch | the drill above: modules `blocked`, x402 `503 gateway_paused`, lifted in seconds |
| **L1** disable one module | `createModuleRegistry({ disabled: 'b2b_negotiator' })` → `checkout_recovery, subscription_salvager, chargeback_evidence, noop`. **Rollback.md was wrong** and is corrected: the module is dropped at boot, so it writes no action row at all rather than a `module_disabled` reason |
| **L2** pause the worker | `config.ts:33` `AEGIS_WORKER_ENABLED` default true; `server.ts:78` only starts the worker when it is true and logs `aegis worker disabled by AEGIS_WORKER_ENABLED=false`. The production probe ran five minutes with it false and claimed no job while 268 were queued |
| **L3** stub the LLM | `AEGIS_LLM_PROVIDER=stub` → `provider=stub model=fixture-v1` |
| **L4** revert a task's code | `git revert --no-commit task-22-done` applies cleanly (aborted immediately); per-task tags `task-01-done … task-23-done` all exist for `git checkout` |
| **L5** revert a migration | on `aegis_test`: `db:migrate:down` → `reverted 0004_ledger_unique`, status `pending: 0004_ledger_unique`; `db:migrate` → `applied 0004_ledger_unique`, `pending: (none)` |

### 24.3 Release gate

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm --filter @aegis/web build
git tag v1.0.0
```

## T25 — sandbox / BYOK mode (verified 2026-09-06, Claude)

Every new test was watched fail before its implementation existed (TDD): `keys.test.ts` (module missing), `factory.test.ts` BYOK block (4 failed / 2 passed), `byok.test.ts` (module missing, then `llmForFingerprint` 2 failed), `ingress.integration.test.ts` sandbox block (2 failed / 12 passed: tenant-signed delivery answered 401, `.env`-signed delivery answered 200), `sandbox.integration.test.ts` (5 failed with the route missing; then, with the route but before the guardrails filter and migration 0005, the two leak tests failed with `expected 13 to be 12` and `expected true to be false`), `sandbox.test.ts` (module missing), `schema.integration.test.ts` (`expected '0005_sandbox_secret_isolation' to be '0004_ledger_unique'`).

```bash
# focused
pnpm --filter @aegis/api exec vitest run src/sandbox/keys.test.ts src/llm/byok.test.ts src/llm/factory.test.ts test/ingress.integration.test.ts test/sandbox.integration.test.ts --no-file-parallelism --maxWorkers=1
# → keys 5, byok 7, factory 6, ingress 14 (10 original + 4 sandbox-secret), sandbox 10 — 5 files / 42 tests passed
pnpm --filter @aegis/api exec vitest run test/schema.integration.test.ts --no-file-parallelism --maxWorkers=1   # → 5 passed (down/up round trip now walks 0005 → 0001 and back)
pnpm --filter @aegis/web test                                                                                   # → 12 files / 48 tests (adds lib/sandbox.test.ts)
pnpm --filter @aegis/web build                                                                                  # → ✓ Compiled successfully in 13.8s, exit 0 (B-024 is a bundler-only failure; this is the gate that sees it)
pnpm typecheck && pnpm test && pnpm lint   # → typecheck green in all three projects; shared 5 files / 47 tests, web 12 / 48, api 52 / 264; lint green (exit 0)

# migration (dev database)
pnpm --filter @aegis/api db:migrate -- --status   # before: pending: 0005_sandbox_secret_isolation
pnpm --filter @aegis/api db:migrate               # → applied 0005_sandbox_secret_isolation
psql … -c "select rowsecurity from pg_tables where tablename='guardrail_config'"      # → t
psql … -c "select policyname, cmd, qual from pg_policies where tablename='guardrail_config'"
# → guardrail_config_hide_sandbox_secrets | SELECT | (key !~~ 'sandbox\_secret\_%'::text)

# live API on port 4000 (tsx watch, dev database), secrets are throwaway test values
curl -X POST localhost:4000/api/v1/sandbox/keys -d '{"account_id":"acc_LiveCurl1","webhook_secret":"whsec_curl_tenant_secret_1","actor":"human:curl"}'
# → {"sandbox":{"account_id":"acc_LiveCurl1","key":"sandbox_secret_acc_LiveCurl1","webhook_secret_fingerprint":"961ed1f72616","updated_by":"human:curl",…}}
# delivery for acc_LiveCurl1 signed with the tenant secret        → {"status":"accepted","event_id":"evt_livecurl_…","duplicate_count":0}
# the same bytes signed with the .env secret                      → {"error":"invalid_signature"} http=401 (row keyed unverified:<sha256>, 0 jobs)
curl localhost:4000/api/v1/guardrails | grep -c sandbox_secret    # → 0 (and 0 occurrences of the secret itself)
psql … -c "select action, entity_type, entity_id, metadata from audit_log where action='sandbox.keys_saved'"
# → sandbox.keys_saved | sandbox_key | sandbox_secret_acc_LiveCurl1 | {"account_id":"acc_LiveCurl1","webhook_secret_fingerprint":"961ed1f72616"}
PGUSER=aegis_readonly psql … -c "select count(*) from guardrail_config where key like 'sandbox\_secret\_%'; select count(*) from guardrail_config"   # → 0 / 12
# C-D3 grep over the diff: every `sk-`/`whsec_` hit is a test fixture (`sk-proj-caller`, `whsec_tenant_*`) or the README/Decisions prose; the only
# `postgres://user:pw@` is the same placeholder the existing ingress test uses. No real credential. The test rows were deleted from the dev database afterwards.
```

**Chrome (2026-09-06, 1280×860 window → 1478×523 viewport, then a 360px iframe).**
- Before the fixes: `/` was a Turbopack overlay (B-024); after the portal fix `[role=dialog]` measured `top 109 / bottom 414` in a 523px viewport (before: `top −124`, centred on the 56px header, B-025).
- Top-bar pill `Demo mode` (accessible name `Demo mode, open sandbox settings`) opens the dialog; focus lands on the first radio; Escape and the backdrop close it.
- Live mode reveals the three fields. Empty save → `Account id is required in Live mode.` and `Webhook secret is required in Live mode.` with `aria-invalid` on both and focus on the account field.
- `acc_ChromeLive1` / a throwaway secret / a fake `sk-proj-…` key → `Save & go live` → toast `Live mode on for acc_ChromeLive1 · Webhook secret stored as sandbox_secret_acc_ChromeLive1 (fingerprint fd467aa991ac). Your model key is attached to every request from this browser.`; pill `Live · acc_ChromeLive1`; `localStorage.aegis.sandbox` holds mode/accountId/webhookSecret/llmKey; the row appeared in `guardrail_config` with `updated_by=human:dashboard`.
- `/ask` "How many payments failed today?" in Live mode → `openai_AuthenticationError: 401 Invalid API key.`, card `degraded: written by rules, not the model`, HTTP 200; network log: `OPTIONS 204` + `POST 200` on `/api/v1/ask` and an `OPTIONS 204` on the history GET (the custom header forces a preflight; CORS reflects it). `nl_queries`: `provider=openai, degraded=t, executed=f, error=openai_AuthenticationError: 401…` — the key reached OpenAI, not the deployment's proxy.
- Modal → Demo → Save → toast `Demo mode`, pill `Demo mode`, stored `mode:"demo"` with the values kept; the same question then `executed`, 1 row, 8.9 s, and the history GET had **no** preflight (no header sent). `nl_queries`: `degraded=f, executed=t, row_count=1`.
- `Forget keys` → `localStorage.aegis.sandbox === null`, pill `Demo mode`, toast explains the API keeps the stored secret until rotated.
- Light theme: dialog, radios, inputs and buttons readable (tokens only). Theme restored to `system` afterwards.
- 360px iframe: `innerWidth 360`, `document.documentElement.scrollWidth 345` (was 454 with the label, B-025), pill 31px icon-only with `aria-label` `Live · acc_ChromeLive1, open sandbox settings`, dialog `left 0 / right 357` as a bottom sheet with all four fields, footer text present.

## Deploy — hosted instance (v1.1.0, 2026-09-06)

Run from the production checkout after `deploy/README.md` steps 1–5. The first block needs no privileges and is what the agent verified before handing over the sudo step; the second needs nginx and the certificate in place.

```bash
pm2 ls                                                     # aegis-api and aegis-web both `online`
curl -s http://127.0.0.1:4000/health                       # "status":"ok", "db":"ok", "version":"1.1.0"
curl -s http://127.0.0.1:4000/api/v1/system                # "env":"development" (D-081), "version":"1.1.0"
curl -sI http://127.0.0.1:3000/ | head -1                  # HTTP/1.1 200 OK
grep -rl "api.aegis.nabhanyubm.tech" apps/web/.next/static | head -1   # the API URL was inlined at build time
ss -ltnp | grep -E ':(3000|4000) '                         # both bound to 127.0.0.1 only
```

```bash
sudo nginx -t                                              # syntax is ok / test is successful
curl -s https://api.aegis.nabhanyubm.tech/health           # same body as above, over TLS
curl -sI https://aegis.nabhanyubm.tech/ | head -1          # HTTP/2 200
curl -sI http://aegis.nabhanyubm.tech/ | head -1           # HTTP/1.1 301 (certbot's redirect)
curl -sI -H "Origin: https://aegis.nabhanyubm.tech" https://api.aegis.nabhanyubm.tech/api/v1/system | grep -i access-control-allow-origin
                                                           # access-control-allow-origin: https://aegis.nabhanyubm.tech
sudo certbot certificates                                  # one certificate, both names, expiry ~90 days out
systemctl is-enabled pm2-nabhanyu                          # enabled (resurrects the `pm2 save` dump on boot)
```

Chrome: open https://aegis.nabhanyubm.tech — the top bar shows `development` and `v1.1.0`, Run demo completes, the Demo-mode pill opens the Sandbox dialog, and the API's log lines carry the client's address rather than 127.0.0.1 (`TRUST_PROXY=loopback`).
