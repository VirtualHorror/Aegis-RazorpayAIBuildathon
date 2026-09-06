# Handoff 8 — Task 6: LLM client abstraction (anthropic / openai / stub)

**Generated**: 2026-09-05 09:21 UTC
**Branch**: `main`
**Baseline**: `task-05-done` (`753c624`) — start your diff there
**Status**: Task 5 verified GREEN. Task 6 is unlocked and is the only task in scope for this handoff.

## Goal

Build the provider layer that every later AI feature calls: one `LlmClient` interface whose only output is zod-validated JSON, with Anthropic / OpenAI / stub adapters behind a resilience wrapper. **This is not the diagnostic router.** The Diagnostician (deterministic hints → LLM → cross-check → fallback) is Task 7 and sits *on top* of this. Keeping them apart is what makes `C-A2` enforceable — T6 owns "how we call a model", T7 owns "what we do with the answer".

Scope is `Checklist.md` §Task 6, steps 6.1–6.8. Do not start Task 7.

## Completed (Task 5, verified — context only, do not redo)

- [x] Simulator CLI: 14 named scenarios + `all` + `burst`, `--dupes/--burst/--seed/--api/--chaos`, canonical builders in `packages/shared/src/sim/`
- [x] Dev-only `POST /api/v1/sim/run`, never mounted when `NODE_ENV === 'production'` (`apps/api/src/app.ts:65`, unit-tested)
- [x] Claude's verification pass added `--contend`, `verifyOriginalDeliveries`, a dev-route delivery cap, and their tests (commit `753c624`)
- [x] Docs: F-007 verified, DV-006, D-042/D-043, D-041 amended, `TestChecklist.md` §T5 re-run, `Flow.md` F11, 2 AM log entry 8

## Not Yet Done (this handoff)

- [ ] 6.1 `anthropic.ts` — `client.messages.parse` + `zodOutputFormat`; `stop_reason === 'refusal'` or null `parsed_output` → `LlmUnavailableError('anthropic_unparsable')`
- [ ] 6.2 `openai.ts` — `response_format: {type:'json_object'}`, retry once without it on a 400 mentioning `response_format`, extract the first `{…}`, one repair attempt appending the zod error
- [ ] 6.3 `stub.ts` + `stub-fixtures.ts` — deterministic per purpose, chosen by input features; must validate against the schema like any provider
- [ ] 6.4 `resilient.ts` — timeout, retry-once on transient, 3-failure/60 s breaker, per-call info log, `x-aegis-chaos: llm_down` via `AsyncLocalStorage`
- [ ] 6.5 `factory.ts` — `auto` resolution + `llm.describe()`; add `GET /api/v1/system`
- [ ] 6.6 `prompts/index.ts` — `{ version, system, buildUser, schema }`; system prompt states enum values verbatim, forbids prose outside JSON
- [ ] 6.7 Tests: `resilient.test.ts`, `stub.test.ts`, `mask.test.ts`, `openai.test.ts`, `anthropic.test.ts` (SDKs mocked); `llm-smoke.ts`
- [ ] 6.8 Commit `feat(t06): provider-agnostic LLM client with resilience and stub`, then `git tag task-06-done`

## Blocker to know about (NOT your task)

**B-007 is open against Task 4.** A `payment.*` and an `order.*` event for the same order still deadlock (`40P01`) when the order row is not yet visible to the payment transaction. The worker retries, the job ends `succeeded` at `attempts=2`, and nothing in the final state records it.

It does **not** block Task 6 — `apps/api/src/llm/` never touches projections. It **must** be fixed before Task 8, because D-035 says T8's orchestrator and the T10/T11 modules extend the global lock order rather than invent their own. The full diagnosis, repro and proposed fix are in `Bug-Feature.md` B-007. Expect `pnpm sim burst --burst N --contend` to exit 1 until it is fixed; that is the correct reading of the current code, not a broken tool.

## Failed Approaches (from the Task 5 verification — do not repeat)

- **Do not re-investigate the simulator's seeded-ID entropy.** A `--seed 20260905` probe returned `accepted=0 duplicate=4`, which looked like an ID-collision design flaw. A 200k-seed sweep appeared to confirm it (~19% collisions) — but that measured the PRNG's **first** draw; a scenario's event id is the **fourth**, where collisions run 4–17 per 100k against an ideal of ~1.2. A brute-force sweep of all 2³² seeds found **exactly two** seeds producing that event id (`20260905` and `3623617836`, the latter a generated seed from an earlier run). The ID scheme is sound; it was a genuine coincidence. The real defect was the *reporting* (exit 0 on a table it could not vouch for), now fixed by `verifyOriginalDeliveries` (D-043).
- **`env -u DATABASE_URL` does not test the simulator's fail-closed path.** `scripts/simulate.ts:20` calls `loadDotenv()` *after* flag parsing, so `.env` puts the variable straight back. Point it at an unreachable host instead: `DATABASE_URL='postgres://nobody:nobody@127.0.0.1:5999/nowhere'`.
- **You cannot read the PostgreSQL server log on this VM.** `/var/log/postgresql/postgresql-16-main.log` is `root:adm` and `sudo` wants a password (DV-001). Use `SELECT deadlocks FROM pg_stat_database WHERE datname='aegis'` (authoritative, cheap), the transient `jobs.last_error` captured mid-retry, or a deterministic two-transaction repro instead.
- **The first B-007 mechanism hypothesis was wrong.** The pure cold-start case (neither parent exists) does *not* deadlock — both transactions take `customers` first, which is a consistent order. The cycle needs the order row to become visible **between** `projectPayment`'s `lockOrder` read and its payment INSERT. Do not chase the cold-start-only story.
- **Vitest green does not mean `tsc` green.** A contended-burst assertion sorted on `webhook.created_at`, which is `.nullable().optional()` in `RazorpayWebhookSchema` (`packages/shared/src/razorpay/webhook.ts:143`). Vitest passed; `pnpm typecheck` failed with `TS2362` / `TS18049`. Always run the full gate, not just the suite you touched.
- **Back-to-back burst probes lie.** A `--burst 40 --contend` run immediately after `--burst 400` came back `rate_limited=40, accepted=0` and exited 0. The ingress limit is 300/min per IP. Wait the window out before a burst probe you intend to read.

## Key Decisions (binding on Task 6)

| Decision | Rationale |
|----------|-----------|
| `LlmClient.completeJson` is the **only** LLM entry point | `C-A2` — only enum values and bounded strings cross the boundary; free-form output never drives control flow |
| Every call site catches `LlmUnavailableError` and falls back deterministically with `degraded=true` | `C-A4` — the system must not depend on a model being up. T6 must make this *easy*, not optional |
| The stub validates against the same zod schema as a real provider | A stub that skips validation hides schema drift until a live run |
| Mask PII before prompting, never after | `C-A7` — `maskEmail` / `maskContact` / `maskPii(obj)` in `mask.ts`; there is no "we'll strip it later" |
| No LLM call inside a transaction holding row locks | `C-A6` — call the model, *then* open the transaction. Relevant to how T7 will consume this |
| New SDK deps need a `Decisions.md` entry | `C-E4` — `@anthropic-ai/sdk` and `openai` are not installed yet; pin with `~` |

## Current State

**Working**: Ingress (T3), worker + projections (T4), simulator (T5). Full gate green at `753c624`: typecheck 3/3 projects, `packages/shared` 5 files / 47 tests, `apps/api` 10 files / 55 tests, lint 3/3.

**Broken**: B-007 (above). `pnpm sim burst --burst N --contend` exits 1 by design until it is fixed.

**Uncommitted changes**: none. `HANDOFF6.md` is untracked and is a stale input file — do not stage it.

## Files to Know

| File | Why It Matters |
|------|----------------|
| `Checklist.md` §Task 6 | The spec. Tick `- [ ]` → `- [x]`; never reword a step (see DV-002) |
| `Architecture.md:160-169` | The exact `LlmPurpose` / `LlmJsonRequest` / `LlmJsonResult` / `LlmClient` / `LlmUnavailableError` shapes you must implement |
| `Constraints.md` §A | C-A1…C-A8. A T6 that makes any of these hard to obey fails review |
| `apps/api/src/config.ts` | Add the LLM vars to `EnvSchema` **and** `.env.example` in the same edit |
| `apps/api/src/app.ts` | Where `GET /api/v1/system` gets registered; note the production guard pattern at `:65` |
| `apps/api/src/ingress/razorpay-webhook.ts` | Must set the `AsyncLocalStorage` chaos flag from `x-aegis-chaos` — **nothing reads that header today** (D-039) |
| `apps/api/src/routes/sim.ts:143` | Where the simulator already sets `x-aegis-chaos: llm_down`; your consumer must match it |
| `packages/shared/src/domain/enums.ts` | Existing enum conventions — diagnosis enums referenced by the stub fixtures belong to the same family |

## Code Context

**The interface you are implementing** (`Architecture.md:161-169`, copy verbatim into `apps/api/src/llm/client.ts`):

```typescript
export type LlmPurpose =
  | 'diagnose_payment_failure' | 'diagnose_subscription_failure'
  | 'draft_negotiation_message' | 'draft_evidence_narrative'
  | 'text_to_sql' | 'summarize_query_result' | 'nl_to_forecast_spec'
  | 'classify_compliance';

export interface LlmJsonRequest<T> {
  purpose: LlmPurpose; system: string; user: string;
  schema: z.ZodType<T>; maxTokens?: number; tier?: 'default' | 'fast';
}
export interface LlmJsonResult<T> {
  data: T; provider: string; model: string;
  latencyMs: number; tokensIn: number; tokensOut: number; raw: string;
}
export interface LlmClient {
  readonly provider: string;
  completeJson<T>(req: LlmJsonRequest<T>): Promise<LlmJsonResult<T>>;
}
export class LlmUnavailableError extends Error {}  // callers MUST catch and fall back
```

**Prompt registry shape** (step 6.6 — every prompt file exports exactly this):

```typescript
export const diagnosePaymentFailure = {
  version: 'v1',
  system: string,                      // states the enum values verbatim; forbids prose outside JSON
  buildUser: (input: DiagnoseInput) => string,
  schema: z.ZodType<DiagnoseOutput>,
};
// callers store input_digest = sha256(system + user)
```

**Stub fixture routing** (step 6.3 — `diagnose_payment_failure`, keyed off simple features of the user text):

| Substring in user text | cause | recommended action |
|---|---|---|
| `payment_authentication` | `THREE_DS_AUTH_FAILED` | `RETRY_LINK_LOCALIZED` |
| `payment_cancelled` | `CUSTOMER_ABANDONED_CHECKOUT` | `CART_RECOVERY_NUDGE` |
| `insufficient_funds` | `INSUFFICIENT_FUNDS` | `RETRY_ALTERNATE_METHOD` |
| `international_transaction_not_allowed` | `CARD_NOT_ENABLED_INTERNATIONAL` | `RETRY_ALTERNATE_METHOD` |
| (else) | `UNKNOWN` | `ESCALATE_HUMAN` |

`provider='stub'`, `model='fixture-v1'`, `latencyMs: 5`. These substrings are exactly what the T5 simulator emits — `packages/shared/src/sim/payments.ts` sets `error_step`/`error_reason` to those values, so `pnpm sim all` end-to-end will exercise every branch once T7 lands.

**`GET /api/v1/system` response** (step 6.5, feeds the dashboard provider pill):

```json
{ "provider": "openai", "model": "gpt-5.6", "modelFast": "gpt-5.4-mini" }
```

**Resilience behaviour that the tests must pin** (step 6.4):

```
timeout            AbortSignal.timeout(LLM_TIMEOUT_MS)   // default 20000
retry              once, only when the LlmUnavailableError message contains
                   RateLimit | Connection | 5xx | timeout
circuit breaker    3 consecutive failures -> open 60 s -> LlmUnavailableError('circuit_open')
log (info, every call)  { purpose, provider, model, latencyMs, tokensIn, tokensOut, ok }
chaos              x-aegis-chaos: llm_down (dev only) -> throw immediately, no provider call
```

## Setup Required

Everything below is already true on this VM — verify, do not re-provision.

- Node 24 via nvm (`source ~/.nvm/nvm.sh && nvm use`), pnpm 11
- PostgreSQL 16 on `localhost:5432`, migrations `0001`–`0003` applied, `pending: (none)`
- **`ANTHROPIC_API_KEY` does not exist on this machine.** `OPENAI_API_KEY` and `OPENAI_API_BASE` are set in the shell (a proxy). `AEGIS_LLM_PROVIDER=stub` always works.
- `@anthropic-ai/sdk` and `openai` are **not installed**. Adding them is part of 6.1/6.2 and needs a `Decisions.md` entry (`C-E4`).
- Port 4000 has an unrelated long-running process on it. Pick another port for probes and stop yours by PID (`kill -TERM <pid>`) — **never `pkill -f`**, it has killed the verification shell before (2 AM log entry 3).

## Resume Instructions

1. `pnpm db:status` → expect `applied: 0001_init, 0002_readonly_grants, 0003_projection_guards` / `pending: (none)`. If pending, run `pnpm db:migrate` first.
2. `pnpm typecheck && pnpm test && pnpm lint` → expect green (shared 47, api 55). **If this is red before you start, stop and say so in the handoff** — it means the baseline moved.
3. Add the SDKs: `pnpm --filter @aegis/api add @anthropic-ai/sdk openai` (pin with `~`). Write the `Decisions.md` entry in the same commit-to-be.
4. Implement 6.1–6.6. Put the `LlmClient` interface in `client.ts` first so the adapters are written against it, not the other way round.
5. Add the env vars to `apps/api/src/config.ts` **and** `.env.example` together — `.env.example` already lists the names Task 6 expects (`AEGIS_LLM_PROVIDER`, `ANTHROPIC_*`, `OPENAI_*`, `LLM_TIMEOUT_MS=20000`), so match them exactly.
6. `AEGIS_LLM_PROVIDER=stub pnpm --filter @aegis/api test -- llm`
   - Expected: stub returns fixtures; the wrapper's timeout, retry-once, and 3-failure breaker each have a test that fails when the behaviour is removed.
   - If a breaker test is flaky: it is wall-clock dependent — inject the clock rather than sleeping.
7. `pnpm --filter @aegis/api llm:smoke`
   - Expected with `OPENAI_API_KEY` set: prints `provider=openai model=<...>` and a schema-validated sample for `diagnose_payment_failure`, exit 0.
   - Expected with no key: prints `provider=stub model=fixture-v1`, exit 0.
   - If it hangs: `LLM_TIMEOUT_MS` is not wired into the adapter's `AbortSignal`.
8. `pnpm typecheck && pnpm test && pnpm lint` — all three, from the repo root.
9. Update `Checklist.md` (tick only), `Flow.md` F4 prerequisites, `Bug-Feature.md` F-008 (status + evidence), `TestChecklist.md` §T6 (make it real, with output you actually saw), `Decisions.md` (the SDK deps, plus anything you deviated on).
10. Commit once: `feat(t06): provider-agnostic LLM client with resilience and stub`, then `git tag task-06-done`. Do not stage `HANDOFF6.md` or `HANDOFF7.md`.

## Edge Cases & Error Handling

- OpenAI proxy rejects `response_format` with a 400 → retry once without it, then fall through to text extraction (step 6.2). Do not treat the 400 as terminal.
- Model returns valid JSON that fails the zod schema → one repair attempt appending the zod error to the user message → still failing → `LlmUnavailableError('openai_invalid_json')`. Two repair attempts is not "more robust", it is a latency bug.
- Anthropic refuses (`stop_reason === 'refusal'`) → `LlmUnavailableError('anthropic_unparsable')`. A refusal is unavailability, not a parse failure to paper over.
- Circuit open + `tier: 'fast'` → still fail fast. The breaker is per client, not per tier.
- No API key at all → `factory.ts` resolves to stub and logs the choice **once at boot**, not per call.
- `x-aegis-chaos: llm_down` in production → must be ignored. The header is dev-only (`C-D5`, D-039).

## Warnings

- **`pnpm test` does not typecheck.** Vitest transpiles without checking. Run all three gates.
- **Do not paste output you did not produce.** `ANTHROPIC_API_KEY` is absent here — the anthropic adapter can only be mock-tested. Say that explicitly in `HANDOFF9.md` rather than inventing a live sample. `AGENTS.md` requires it and the verification pass will check it.
- **Tick checklist steps, never reword them.** DV-002 exists because that happened once; the step text is the spec the implementation gets diffed against.
- **Every new `.ts` outside `apps/*` and `packages/*` must be inside a typecheck and lint program.** `apps/api/scripts/llm-smoke.ts` is inside `apps/api`, so it is already covered by `include: ["src", "test", ...]` — confirm with `tsc --noEmit --listFiles | grep llm-smoke` rather than assuming (B-003).
- **`--chaos llm_down` is currently transport-only.** The simulator sets the header; nothing reads it. Wiring the `AsyncLocalStorage` consumer is yours (6.4) and it needs an ingress-side change, so touch `razorpay-webhook.ts` carefully — T3's idempotency invariants (`C-C1`, B-004) are not negotiable.
- **The dev database holds a lot of simulator probe rows** from T5 and its verification: `webhook_events` = 1,902 and `payments` = 1,722 as of `753c624`, mostly `acc_simulator` fixtures. They are harmless projections, `pnpm db:seed` is unaffected, and prior tasks accepted the same (`TestChecklist.md` §T4). Do not "clean them up" as part of T6.
