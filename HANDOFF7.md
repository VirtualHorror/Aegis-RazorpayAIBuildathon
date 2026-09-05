# Handoff 7 - Task 5: Razorpay webhook simulator CLI

**Generated**: 2026-09-05 08:14 UTC
**Branch**: `main`
**Status**: Task 5 implemented and verified locally; ready for the single task commit/tag
**Baseline**: `task-04-done` (`fe4ddbc`)

## Built

- Added canonical deterministic simulator builders under `packages/shared/src/sim/` for all 14 Checklist scenario names, plus `all` and `burst` aggregation.
- Added seeded natural-key IDs and byte-reproducible envelopes. `payment_captured_after_retry` reuses the first failure order/customer in `buildAllScenarios`.
- Added `scripts/simulate.ts` with `--dupes N`, `--burst N`, `--seed S` (numeric or text), `--api URL`, and `--chaos llm_down`.
- Kept the CLI entrypoint thin by splitting flag parsing, transport, output, and durable verification into focused `scripts/sim/` modules.
- Duplicate deliveries reuse the exact serialized body and headers. HTTP 429 is classified and totaled as `rate_limited`, never as a normal rejection.
- Unknown events are classified only after a durable `webhook_events` check confirms `ignored` and zero jobs. Missing DB verification fails closed.
- Burst verification fails on any `attempts > 1` as a critical lock-order regression and requires every accepted job to succeed.
- Added `scripts/sim/signer.ts` and equality coverage against the API HMAC implementation.
- Added development-only `POST /api/v1/sim/run`; production route guard returns 404.
- Added the API `sim` script, included `scripts/` in API typecheck/lint, and exported simulator APIs from `@aegis/shared`.
- Updated `Checklist.md`, `Architecture.md`, `Flow.md`, `Bug-Feature.md`, `TestChecklist.md`, and `Decisions.md` (D-036 through D-041). `TestChecklist.md` T5 now uses `payment_failed_3ds_intl` and `--burst N`.

## Verification

Prerequisites:

```text
localhost:5432 - accepting connections
applied: 0001_init, 0002_readonly_grants, 0003_projection_guards
pending: (none)
```

Typecheck coverage proof:

```text
/home/nabhanyu/Downloads/RazorpayAIBuildathon/scripts/sim/signer.ts
/home/nabhanyu/Downloads/RazorpayAIBuildathon/scripts/sim/types.ts
/home/nabhanyu/Downloads/RazorpayAIBuildathon/scripts/sim/cli.ts
/home/nabhanyu/Downloads/RazorpayAIBuildathon/scripts/sim/output.ts
/home/nabhanyu/Downloads/RazorpayAIBuildathon/scripts/sim/verification.ts
/home/nabhanyu/Downloads/RazorpayAIBuildathon/scripts/sim/transport.ts
/home/nabhanyu/Downloads/RazorpayAIBuildathon/scripts/simulate.ts
/home/nabhanyu/Downloads/RazorpayAIBuildathon/scripts/sim/ids.ts
/home/nabhanyu/Downloads/RazorpayAIBuildathon/scripts/sim/scenarios.ts
```

Focused tests:

```text
shared scenarios: Test Files 1 passed; Tests 21 passed
API signer + production guard: Test Files 2 passed; Tests 5 passed
```

Live CLI probes against an owned development API on port 4055:

```text
payment_failed_3ds_intl --dupes 3 --seed 429496729
totals accepted=1 duplicate=3 rejected=0 ignored=0 rate_limited=0

unknown_event --seed 314159265
HTTP 200, status ignored; durable row status=ignored and job count=0

burst --burst 50 --seed t05-final-50
totals accepted=50 duplicate=0 rejected=0 ignored=0 rate_limited=0
burst verification jobs=50/50 succeeded=50 max_attempts=1

burst --burst 400 --seed t05-final-400
totals accepted=250 duplicate=0 rejected=0 ignored=0 rate_limited=150
burst verification jobs=250/400 succeeded=250 max_attempts=1
```

The 400-event run hit the ingress 300-per-minute limit. All 150 HTTP 429 responses were reported separately as `rate_limited`; no accepted job had a retry. A prior `all --seed 321` probe also produced 12 accepted, one durable ignored unknown event, and one rejected bad signature under `unverified:<sha256(raw)>`. The development route returned the same ignored classification for `POST /api/v1/sim/run`.

Unreachable API behavior:

```text
exit=1
simulator error: simulator could not reach http://127.0.0.1:4999/webhooks/razorpay: fetch failed
```

Combined final gate (`pnpm typecheck && pnpm test && pnpm lint`):

```text
packages/shared typecheck: Done
apps/api typecheck: Done
apps/web typecheck: Done
packages/shared test: Test Files 5 passed; Tests 46 passed
apps/api test: Test Files 10 passed; Tests 54 passed
apps/web test: Done
packages/shared lint: Done
apps/api lint: Done
apps/web lint: Done
```

`git diff --check` passed. The Task 5 API was stopped with `kill -TERM 131623`; port 4055 was confirmed closed. The unrelated existing process on port 4000 was left untouched. No LLM calls or API keys were needed.

## Deviation

`DV-005` records the stale pending T5 examples (`payment_failed_3ds` and `--n`) and the canonical shared-builder placement required by `HANDOFF6.md`. The direct builder default seed remains deterministic for unit tests; CLI and dev-route runs generate and print a fresh seed when `--seed` is omitted.

## Commit and next task

Commit once at the end as:

```text
feat(t05): razorpay webhook simulator
```

Then tag `task-05-done`. Do not stage the untracked input `HANDOFF6.md`.

Next task: Task 6, LLM client abstraction. Do not begin it in this handoff.
