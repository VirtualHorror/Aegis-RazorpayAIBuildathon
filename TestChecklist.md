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

## T4 — worker + projections (acceptance, pending)

```bash
pnpm --filter @aegis/api test -- worker projections
# claimJob with 4 concurrent loops never double-claims (100 jobs → 100 successes, 0 dupes)
# failing job retried with backoff, dead-lettered after max_attempts
# payments: captured after authorized applies; authorized after captured ignored; anything after failed ignored
# subscriptions: stale (older created_at) event ignored
```

## T5 — simulator (acceptance, pending)

```bash
pnpm sim payment_failed_3ds --dupes 3       # table: accepted=1 duplicate=3 rejected=0
pnpm sim burst --n 50                       # accepted=50, p95 latency printed, DB shows 50 events / 50 jobs
pnpm sim all                                # runs every scenario once
```

## T6 — LLM client (acceptance, pending)

```bash
AEGIS_LLM_PROVIDER=stub pnpm --filter @aegis/api test -- llm      # stub returns fixtures; resilient wrapper: timeout, retry-once, circuit opens after 3 failures, LlmUnavailableError thrown
pnpm --filter @aegis/api llm:smoke          # prints provider/model + a validated JSON sample; exits 0 with openai key, prints "stub" without any key
```

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
