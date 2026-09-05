# Handoff 11 — Task 7 complete: Diagnostician

**Generated**: 2026-09-05 16:58 UTC
**Branch**: `main`
**Baseline**: `task-06-done` (`0f3addf`)
**Status**: Task 7 is complete and ready for Task 8.

## Built

- Added deterministic diagnosis hints with integer-paise amount bands and caller-supplied `prior_failures_24h`.
- Added all eight cross-check rules. Every override is retained in `output.cross_check` with an audit note.
- Added rule-based fallback for `LlmUnavailableError`, including degraded metadata and the required rationale prefix.
- Added `Diagnostician`: masked prompt construction, one zod-validated LLM call outside projection transactions, cross-check, persistence, and an unapplied-snapshot skip.
- Added the diagnoses repository. PostgreSQL `numeric(4,3)` confidence is parsed to a JavaScript number at the repository boundary.
- Extended recursive PII masking for nested card number, CVV, and expiry fields.
- Added focused unit/integration coverage for six scenarios, every cross-check row, nested masking, stale/unapplied events, the throwing client, and the confidence round trip.

## Verification

Focused Task 7 suite:

```text
$ pnpm --filter @aegis/api exec vitest run src/diagnosis src/db/repos/diagnoses.test.ts --reporter verbose
Test Files  5 passed (5)
Tests       38 passed (38)
Start       2026-09-05 16:57:00 UTC
```

Full gate, three valid runs after pinning the API package script to
`vitest run --no-file-parallelism --maxWorkers=1`:

```text
$ pnpm typecheck && pnpm test && pnpm lint
run 1 (16:53 UTC): typecheck 3 projects; shared 5 files / 47 tests; API 23 files / 128 tests; lint 3 projects; exit 0
run 2 (16:54 UTC): typecheck 3 projects; shared 5 files / 47 tests; API 23 files / 128 tests; lint 3 projects; exit 0
run 3 (16:57 UTC): typecheck 3 projects; shared 5 files / 47 tests; API 23 files / 128 tests; lint 3 projects; exit 0
```

The first unpinned root `pnpm test` attempt failed with worker/schema interference (`relation "jobs" does not exist` and
contaminated ingress assertions). After the script pin, one trial was also discarded because another focused Vitest
process was concurrently using `aegis_test`; it reported a diagnosis insert deadlock and a projection FK failure. That
process was stopped, and the focused suite plus the three gates above were rerun without another test process. See
`Bug-Feature.md` B-005 and 2 AM log entry 9.

## Constraints and deviations

- D-045: `diagnosis/schema.ts` re-exports `ROOT_CAUSES`, `STRATEGIES`, and the diagnosis schema from
  `apps/api/src/llm/prompts/index.ts`; it does not restate them. Recorded as DV-007 and D-045.
- C-A6: the LLM request completes before `insertDiagnosis`; no model call runs inside a projection transaction.
- C-A7: nested card fields are recursively masked before prompt construction.
- Numeric confidence is normalized before cross-check consumers see repository data.
- B-009 remains open. No chaos-store propagation or `isLlmDown()` code was changed; Task 8 owns worker wiring.
- D-046: an unapplied projection snapshot returns a marked, deterministic non-persisted result and does not spend an LLM call.
- D-047: explicit Vitest serial flags are part of the API test script because config-only limits did not reliably serialize
  the shared PostgreSQL suite under Vitest 5.

## Files and handoff

Task 7 files are the new `apps/api/src/diagnosis/*`, `apps/api/src/db/repos/diagnoses.ts` and its tests, the recursive
masking change/tests, `apps/api/package.json`, and the Task 7 docs. Do not stage the stale untracked `HANDOFF6.md`,
`HANDOFF8.md`, or the input `HANDOFF10.md`.

Next task: **Task 8 — EventOrchestrator, action-module contract, actions audit, and SSE bus**. The worker must carry
the development-only chaos flag on its job payload and re-enter the chaos context before invoking this diagnostician.
