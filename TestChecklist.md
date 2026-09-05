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

## T2 — migrations + schema + seed (acceptance, pending)

```bash
pnpm db:migrate                             # applies 0001_init … prints "applied N migrations"; re-run prints "0 pending"
pnpm db:migrate:down                        # reverts the last migration; re-apply works
psql $DATABASE_URL -c "\dt"                 # lists all tables from Architecture.md §6
psql $DATABASE_URL -c "select count(*) from guardrail_config"    # 12
pnpm db:seed                                # "seeded: customers=…, products=…, guardrails=12"; idempotent on re-run
psql $DATABASE_URL_READONLY -c "select email from customers limit 1"   # ERROR: permission denied for table customers (column-level grants exclude PII)
pnpm --filter @aegis/api test -- migrate    # unit tests for version ordering and checksum mismatch detection pass
```

## T3 — webhook ingress (acceptance, pending)

```bash
pnpm --filter @aegis/api test -- ingress
# unit: signature valid/invalid/length-mismatch; eventId fallback to sha256
# integration (aegis_test): 20 concurrent identical POSTs → 1 row, duplicate_count=19, exactly 1 job; invalid signature → 401 + row with signature_valid=false
curl -s -X POST localhost:4000/webhooks/razorpay -H 'content-type: application/json' -d '{}'   # 401 {"error":"invalid_signature"}
```

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
