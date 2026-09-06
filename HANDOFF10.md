# Handoff 10 — Task 7: Diagnostician (deterministic hints → LLM → cross-check → fallback)

**Generated**: 2026-09-05 16:05 UTC
**Branch**: `main`
**Baseline**: `task-06-done` (`0f3addf`) — start from a clean `git diff task-06-done..HEAD`
**Status**: Ready to start. Task 6 is verified GREEN; Task 7 is unlocked and is the only task in scope.

## Goal

Build `apps/api/src/diagnosis/`: for `payment.failed` and `subscription.pending|halted`, produce one `Diagnosis` — root cause and intervention strategy drawn from fixed enums — by combining deterministic hints, one zod-validated LLM call, a hard-coded cross-check table that can override the model, and a rule-based fallback when the model is unavailable. Persist it to `diagnoses`.

This is `Checklist.md` **Task 7**, steps 7.1–7.6. Do not start Task 8.

## Completed (Task 6, verified — context only, do not redo)

- [x] `apps/api/src/llm/` — `client.ts` (interface + `LlmUnavailableError` + `LlmPurpose`), `anthropic.ts`, `openai.ts`, `stub.ts`, `stub-fixtures.ts`, `resilient.ts`, `factory.ts`, `mask.ts`, `prompts/index.ts`.
- [x] `GET /api/v1/system` → `{ provider, model, modelFast }`; provider logged once at boot; `pnpm --filter @aegis/api llm:smoke`.
- [x] `x-aegis-chaos: llm_down` parsed by the ingress in development/test only, stored in `AsyncLocalStorage`; covered by `apps/api/test/chaos.integration.test.ts` including the production-off case (C-D5).
- [x] Claude's verification commit `0f3addf`: single-sourced the diagnosis contract (D-045), added the chaos suite, fixed flaky test B-008.

Gate at baseline, run three consecutive times: `pnpm typecheck && pnpm test && pnpm lint` → shared 5 files/47 tests, api 18 files/89 tests, lint 3 projects.

## Not Yet Done (this handoff)

- [ ] 7.1 `hints.ts` (pure) — amount bands `<₹500 micro`, `<₹5,000 small`, `<₹50,000 medium`, else `large`; `prior_failures_24h` is **passed in by the caller**, default 0.
- [ ] 7.2 `cross-check.ts` — implement the eight-row override table in `Checklist.md` exactly; every rule that fires appends a note.
- [ ] 7.3 `fallback.ts` — rule-based diagnosis from hints (same mapping as the stub), `confidence 0.6`, rationale prefixed `rule-based fallback:`, used when `LlmUnavailableError` is thrown; `degraded=true`, `degraded_reason=error.message`.
- [ ] 7.4 `diagnostician.ts` — hints → prompt (masked payload) → `llm.completeJson` → cross-check → persist → return. **Never inside a transaction (C-A6).**
- [ ] 7.5 `db/repos/diagnoses.ts` + tests: six fixtures (one per T5 scenario) through the stub, a throwing client → degraded, and **every** cross-check row.
- [ ] 7.6 Update `Flow.md` F4 `[planned T7]` → `[live]`, `Bug-Feature.md` F-009, `TestChecklist.md` §T7, `Decisions.md` if you deviate. Commit `feat(t07): diagnostician with deterministic hints and cross-checks`, then `git tag task-07-done`.

## Blockers to know about (NOT your task — do not fix)

- **B-007** (open, T4 code): a `payment.*` + `order.*` pair for the same order still deadlocks when the order row is not yet visible to the payment transaction. It self-heals on retry (`attempts=2`). It lives in `apps/api/src/orchestrator/projections/payments.ts`, not in your files. Scheduled before Task 8 extends the global lock order.
- **B-009** (open): the `x-aegis-chaos: llm_down` flag lives in an `AsyncLocalStorage` store installed around the **ingress request**. The worker polls in its own async context, so the store never reaches a diagnosis running there. The fix (carry the flag on the `process_event` job payload) belongs to **Task 8's wiring**, not to you. Consequence for Task 7: **do not call `isLlmDown()` and do not depend on the chaos store anywhere in `diagnosis/`.** Test your degraded path with a throwing client, which is what step 7.5 already asks for.

## Failed Approaches (do not repeat)

- **Defining the diagnosis enums/schema in your own module.** Task 6 did exactly that — `stub-fixtures.ts` restated `ROOT_CAUSES`, `STRATEGIES` and `DiagnoseOutputSchema` instead of importing the prompt registry's copy, and `stub.test.ts` validated fixtures against that local copy. The stub, whose stated purpose is catching schema drift, was structurally blind to it: adding a root cause to the real prompt would have left every stub test green while the stub began throwing `stub_invalid_fixture` at runtime, silently degrading every diagnosis to the fallback. Fixed in `0f3addf` (**D-045**). **`Checklist.md`'s own Task 7 interface block still shows a restated copy — that block is describing the contract, not instructing you to re-declare it.** See Warnings.
- **`env -u DATABASE_URL` to test a fail-closed path.** `scripts/simulate.ts:20` calls `loadDotenv()` *after* flag parsing, so `.env` puts the variable straight back and the test proves nothing. Point it at an unreachable host instead: `DATABASE_URL='postgres://nobody:nobody@127.0.0.1:5999/nowhere'`.
- **Trusting one green `pnpm test`.** Task 6's handoff pasted a green gate; the first root run in verification failed. `worker.integration.test.ts` queued both subscription events at once under a `concurrency: 2` worker and asserted `version: 1`, but `FOR UPDATE SKIP LOCKED` picks either job first — a ~1-in-4 flake (B-008, fixed). Run the gate more than once, and never assert a counter (`version`, `attempts`, call counts) reached through a concurrent scheduler.
- **`kill -TERM` on the `pnpm --filter … start` wrapper.** It does not propagate to the `tsx src/server.ts` child; the port stays bound. Find the real owner with `ss -ltnp | grep :<port>` and TERM that pid.

## Key Decisions (binding on Task 7)

| Decision | Rationale |
|----------|-----------|
| `apps/api/src/llm/prompts/index.ts` is the **only** definition of `ROOT_CAUSES`, `STRATEGIES`, `DiagnoseOutputSchema`. `diagnosis/schema.ts` re-exports it. | D-045. Two copies of a contract cannot be enforced against each other; the duplicate made the stub blind to drift. |
| Cross-check overrides are recorded, never silent. | C-A3. Every rule that fires appends a note to `crossCheck.notes` and sets `overridden`. |
| Every LLM failure path produces a deterministic diagnosis with `degraded=true`. | C-A4. The system must never depend on a model being up. |
| Confidence gates escalation only. | C-A1. It may not feed a retry count, a discount, an amount, or a schedule. |
| The LLM call happens outside any transaction. | C-A6, and `resilient.ts` can block up to `2 × LLM_TIMEOUT_MS` (see Warnings). |
| Stopping rules live in code. | C-B3. `prior_failures_24h >= 3 → ESCALATE_HUMAN` is a guard, not a prompt instruction. |

## Current State

**Working**: everything through Task 6. API boots, ingress is idempotent, the worker projects entities, the simulator drives scenarios, and `LlmClient` returns zod-validated JSON from anthropic / openai / stub behind one resilient wrapper.

**Broken**: nothing at the baseline. B-007 is an open self-healing deadlock in T4 code (see Blockers).

**Uncommitted Changes**: none. `HANDOFF6.md` and `HANDOFF8.md` are untracked stale inputs — **do not stage them**.

## Files to Know

| File | Why It Matters |
|------|----------------|
| `apps/api/src/llm/prompts/index.ts` | The single source of `ROOT_CAUSES`, `STRATEGIES`, `DiagnoseOutputSchema`, `diagnosePaymentFailure`, `diagnoseSubscriptionFailure`, `inputDigest`. Import from here. |
| `apps/api/src/llm/client.ts` | `LlmClient.completeJson`, `LlmUnavailableError` — the only error you catch for the fallback. |
| `apps/api/src/llm/mask.ts` | `maskEmail`, `maskContact`, `maskPii` — call before building any prompt (C-A7). See Warnings for its gap. |
| `apps/api/src/llm/stub-fixtures.ts` | `fixtureForPaymentFailure(user)` — the feature→diagnosis mapping your `fallback.ts` must mirror. |
| `apps/api/src/orchestrator/entity.ts` | `EntitySnapshot`, the third input to `diagnose()`. |
| `apps/api/src/worker/process-event.ts` | Where Task 8 will call you from. Read it, do not modify it. |
| `db/migrations/0001_init.sql:131` | The `diagnoses` table. **Already exists — no migration needed.** |
| `apps/api/src/db/pg-types.ts` | Only int8 is parsed. See Warnings about `numeric`. |
| `Constraints.md` §A | The AI-boundary rules this task is judged against. |

## Code Context

**The contract you must import, not restate** (`apps/api/src/llm/prompts/index.ts`):

```ts
export const ROOT_CAUSES = ['THREE_DS_AUTH_FAILED','ISSUER_DECLINED','INSUFFICIENT_FUNDS',
  'CARD_NOT_ENABLED_INTERNATIONAL','CUSTOMER_ABANDONED_CHECKOUT','NETWORK_TIMEOUT','RISK_BLOCKED',
  'SUBSCRIPTION_MANDATE_FAILED','UNKNOWN'] as const;
export const STRATEGIES = ['RETRY_LINK_LOCALIZED','RETRY_ALTERNATE_METHOD','CART_RECOVERY_NUDGE',
  'SUBSCRIPTION_DUNNING','B2B_NEGOTIATE','NO_ACTION','ESCALATE_HUMAN'] as const;

export const DiagnoseOutputSchema = z.object({
  root_cause: z.enum(ROOT_CAUSES),
  confidence: z.number().min(0).max(1),
  intervention_strategy: z.enum(STRATEGIES),
  rationale: z.string().min(10).max(600),
  customer_facing_hint: z.string().max(240).optional(),
});
export type DiagnoseOutput = z.infer<typeof DiagnoseOutputSchema>;

export interface DiagnoseInput { hints: Record<string, unknown>; payloadMasked: unknown; entity?: unknown }
export const diagnosePaymentFailure: PromptDefinition<DiagnoseInput, DiagnoseOutput>;      // { version:'v1', system, buildUser, schema }
export const diagnoseSubscriptionFailure: PromptDefinition<DiagnoseInput, DiagnoseOutput>;
export function inputDigest(system: string, user: string): string;   // sha256 hex — store it
```

So `apps/api/src/diagnosis/schema.ts` should be, in essence:

```ts
export { ROOT_CAUSES, STRATEGIES, DiagnoseOutputSchema as DiagnosisSchema, type DiagnoseOutput } from '../llm/prompts';
export type RootCause = (typeof ROOT_CAUSES)[number];
export type Strategy  = (typeof STRATEGIES)[number];
```

**The LLM boundary you call**:

```ts
export interface LlmJsonRequest<T> {
  purpose: LlmPurpose; system: string; user: string; schema: z.ZodType<T>;
  maxTokens?: number; tier?: 'default' | 'fast';
}
export interface LlmJsonResult<T> {
  data: T; provider: string; model: string; latencyMs: number; tokensIn: number; tokensOut: number; raw: string;
}
export interface LlmClient { readonly provider: string; completeJson<T>(req: LlmJsonRequest<T>): Promise<LlmJsonResult<T>> }
export class LlmUnavailableError extends Error { readonly reason: string }
```

**Inputs you receive** (`apps/api/src/orchestrator/entity.ts`, `apps/api/src/worker/process-event.ts`):

```ts
export interface EntitySnapshot {
  readonly type: EntityType;
  readonly row: ProjectionRow;
  readonly customer: CustomerRow | null;   // .locale, .country, .contact, .email
  readonly applied: boolean;               // false when the event was a duplicate or lost its precedence guard
}

interface WebhookEventRow {
  event_id: string; event_type: string; payload: unknown;
  signature_valid: boolean; rzp_created_at: Date | null; status: string;
}
```

**Interfaces to produce** (from `Checklist.md` Task 7 — reproduce these shapes, but import the enums):

```ts
export interface Hints {
  entity: 'payment' | 'subscription';
  is_international: boolean;
  method: string | null;
  error_step: string | null;
  error_reason: string | null;
  error_source: string | null;
  amount_band: 'micro' | 'small' | 'medium' | 'large';
  customer_locale: string;
  prior_failures_24h: number;
}

export interface Diagnosis {
  id: string; rootCause: RootCause; strategy: Strategy; confidence: number; rationale: string;
  degraded: boolean; degradedReason?: string;
  crossCheck: { overridden: boolean; notes: string[] };
  provider: string; model: string;
}

export interface Diagnostician {
  diagnose(input: { event: WebhookEventRow; payload: RazorpayWebhook; entity: EntitySnapshot }): Promise<Diagnosis>;
}
```

**Where the hint fields come from** — all already projected, no new columns needed:

```sql
-- payments (0001_init.sql)
method, international, error_code, error_description, error_source, error_step, error_reason, amount_paise
-- customers
locale text NOT NULL DEFAULT 'en-IN', country, contact, email
```

**The destination table — already exists, do not write a migration**:

```sql
CREATE TABLE diagnoses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id text NOT NULL REFERENCES webhook_events(event_id),
  entity_type text NOT NULL, entity_id text NOT NULL,
  hints jsonb NOT NULL, provider text NOT NULL, model text NOT NULL, prompt_version text NOT NULL, input_digest text NOT NULL,
  output jsonb NOT NULL, root_cause text NOT NULL, confidence numeric(4,3) NOT NULL, strategy text NOT NULL, rationale text NOT NULL,
  degraded boolean NOT NULL DEFAULT false, degraded_reason text, latency_ms integer, tokens_in integer, tokens_out integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX diagnoses_entity_idx ON diagnoses (entity_type, entity_id, created_at DESC);
```

There is **no `cross_check` column**. Put `{ overridden, notes }` inside the `output` jsonb alongside the model's raw validated result.

**Helpers that already exist — do not rewrite them**:

```ts
import { assertSafePaise, countryFromContact } from '@aegis/shared';   // packages/shared
import { maskPii, maskEmail, maskContact } from '../llm/mask';
import { fixtureForPaymentFailure } from '../llm/stub-fixtures';        // mirror this mapping in fallback.ts
```

## Setup Required

- `source ~/.nvm/nvm.sh && nvm use` (Node 24.20.0), pnpm 11.
- `pg_isready` must accept; `DATABASE_URL_TEST` must be set for the repo integration test.
- No `ANTHROPIC_API_KEY` on this machine. `OPENAI_API_KEY` + `OPENAI_API_BASE` exist but the proxy has been slow to respond. **Develop and test against `AEGIS_LLM_PROVIDER=stub`**; do not claim live model output you did not observe.

## Resume Instructions

1. `git log --oneline -3` → expect `0f3addf` at HEAD with tag `task-06-done`. Read `Checklist.md` Task 7 (line 400) and `Constraints.md` §A.
2. Confirm the baseline is green before you touch anything:
   `pnpm typecheck && pnpm test && pnpm lint`
   - Expected: shared 5 files/47 tests; api 18 files/89 tests; lint 3 projects.
   - If red: stop and report — you did not cause it.
3. Write `apps/api/src/diagnosis/schema.ts` as a re-export of `../llm/prompts` (see Code Context). Then `hints.ts`, `cross-check.ts`, `fallback.ts` as pure modules with unit tests before `diagnostician.ts`.
4. Verify the cross-check table row by row. Each of the eight rows in `Checklist.md` 7.2 needs its own test asserting both the override **and** the note it appends.
   - Expected: a model output of `{root_cause:'ISSUER_DECLINED', confidence:0.9, ...}` with `error_step='payment_authentication'` comes back as `THREE_DS_AUTH_FAILED` with `crossCheck.overridden === true` and one note.
5. Prove the degraded path with a client that throws `LlmUnavailableError`:
   - Expected: a deterministic diagnosis, `degraded === true`, `degradedReason` set, rationale starting `rule-based fallback:`, and a persisted row with `degraded = true`.
6. Prove persistence round-trips: insert a diagnosis, read it back, and assert `confidence` is a **number**, not `"0.900"` (see Warnings).
7. Run the full gate **three times**: `pnpm typecheck && pnpm test && pnpm lint`.
   - Expected: green every time, api test count up by your new files.
   - If one run differs: you have a flake. Fix the ordering, do not loosen the assertion.
8. Update `Flow.md` F4 → `[live]`, `Bug-Feature.md` F-009, `TestChecklist.md` §T7 with real pasted output, then commit once and tag `task-07-done`.

## Edge Cases & Error Handling

- Model returns a valid-but-wrong enum → cross-check overrides it, note appended, `overridden = true`. Not an error.
- Model unavailable / times out / circuit open → `LlmUnavailableError` → `fallback.ts`, `degraded = true`, still persisted. **Never** let it propagate as a 5xx or a failed job.
- `confidence < 0.5` → strategy forced to `ESCALATE_HUMAN` (7.2 row 7), even if the model was confident about the root cause.
- `prior_failures_24h >= 3` → `ESCALATE_HUMAN`. Stopping rule, code not prompt (C-B3).
- `entity.applied === false` (duplicate or precedence-guarded event) → decide and document whether you diagnose at all; a stale event should not produce a fresh diagnosis row. Record the choice in `Decisions.md`.
- `entity.customer === null` → `customer_locale` falls back to `'en-IN'` (the column default); do not ask the model for a locale.
- Missing `error_step`/`error_reason` (subscription events rarely carry them) → hints carry `null`, the fallback lands on `UNKNOWN`/`ESCALATE_HUMAN`.

## Warnings

- **`Checklist.md`'s Task 7 interface block shows `ROOT_CAUSES`, `STRATEGIES` and `DiagnosisSchema` written out in full. That is the contract being *described*, not an instruction to re-declare it.** Re-declaring creates the third copy of a contract Claude just collapsed to one (D-045) and will fail review. Per checklist hygiene: **do not reword step 7.2 or the interface block** — leave the text alone and record the deviation in `Bug-Feature.md` under "Deviations".
- **`confidence` is `numeric(4,3)` and `apps/api/src/db/pg-types.ts` only registers a parser for int8 (OID 20).** node-postgres returns `numeric` as a **string**, so a diagnosis read back gives `"0.900"`. Parse it at the repo boundary. `confidence < 0.5` against a string is a silent bug.
- **`maskPii` keys off field names and does not mask a nested `card: { number }`** — only a literal `card_number` / `cardNumber` / `card.number` key matches. You are the first caller to build a masked payload from a real Razorpay body, so extend `mask.ts` or select fields explicitly (C-A7, C-D4).
- **`resilient.ts` can block for up to `2 × LLM_TIMEOUT_MS` (40 s default)**, because a `timeout` failure matches the transient regex and the retry arms a fresh `AbortSignal`. This is exactly why C-A6 forbids calling it inside a transaction — call the LLM first, then open the transaction to persist.
- **Do not use `isLlmDown()` or the chaos store in `diagnosis/`** (B-009). The worker cannot see it.
- **`pnpm --filter @aegis/api test -- llm` does not filter** — pnpm forwards the argument but vitest runs the whole suite. Use `pnpm --filter @aegis/api exec vitest run src/diagnosis` to run your files alone.
- Do not stage `HANDOFF6.md` or `HANDOFF8.md`. Never commit `.env`, `node_modules`, `.next`, `backups/`.
- One task per handoff. Task 8 (EventOrchestrator) wires the diagnostician into the worker — it is not yours.
