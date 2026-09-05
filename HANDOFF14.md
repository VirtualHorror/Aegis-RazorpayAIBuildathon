# Handoff 14 — Sprint 2: Tasks 10 → 16 in one continuous run

**Generated**: 2026-09-05 (Claude, Lead Technical Architect / Verification Agent)
**Branch**: `main`
**Baseline**: `task-09-done` (moved onto the T8/T9 verification commit — start your diff from there)
**Previous verdict**: **T8 and T9 are GREEN.** B-007 and B-009 confirmed fixed; zero LLM calls inside any transaction. No code changes were needed during verification.

---

## 0. How to run this sprint

This handoff carries **seven checklist tasks (T10–T16)**. This is a deliberate, recorded deviation from **C-G1** ("one checklist task per handoff") — see **D-052** in `Decisions.md`. Everything else in `Constraints.md` still applies in full.

**Process them modularly, in one continuous run, in numeric order.**

- **One commit per task**, using the checklist's exact commit message (`feat(t10): …` … `feat(t16): …`). Do not squash. Bisectability is the only thing keeping C-G1's value alive here.
- **Each task must be green on its own tests before you start the next one.** If task N goes red and you cannot fix it, stop, record it in `Bug-Feature.md` → Deviations, and continue with the next *independent* task (T14, T15, T16 do not depend on T10–T13). Say clearly in `HANDOFF15.md` which tasks are green and which are not — do not silently narrow scope.
- **T14 (x402), T15 (Ask Aegis) and T16 (Compliance) are major standalone features, not glue.** Each needs its own routes, its own tests and its own `TestChecklist.md` section with real pasted output. They do not depend on T10–T13, so if the module work slips, these three must still land complete.
- Run the full gate (`pnpm typecheck && pnpm test && pnpm lint`) after every task, not just at the end.

---

## 1. Non-negotiables (re-read before writing code)

| Rule | What it means for this sprint |
|---|---|
| **C-A2 / C-A6 — no LLM in locks** | **Zero LLM calls inside a transaction.** T11 and T12 both call the model. The call must happen *outside* any `withTransaction`/`BEGIN` block and outside `SELECT … FOR UPDATE`. The existing pattern is already correct: `EventOrchestrator.ts:117-129` commits the projection *then* diagnoses, and `execute.ts` runs `module.execute` *between* two short `withClientTransaction` phases. Copy that shape; never introduce a third one. Verification will grep every `withTransaction`/`BEGIN` site again. |
| **C-C3 — one global lock order** | `disputes → payments → orders → customers`, with `subscriptions` and `invoices` directly above `customers`. Sprint 2 **extends** it (see §2, entity updates during execution): `actions → (subscriptions \| invoices \| disputes) → payments → orders → customers`. Never lock `actions` *after* an entity row. Never invert. An absent-row `SELECT … FOR UPDATE` takes no lock — if you need to reserve an unseen row, use the `lockOrderSlot` pattern in `orchestrator/projections/shared.ts:96`. |
| **C-A3 — deterministic cross-check** | T11's offer numbers and T16's evidence span are computed/verified in TypeScript. The model only writes prose. T16 must verify `description.includes(evidence_span)` case-sensitively and downgrade to `needs_review` on failure. |
| **C-A4 — never depend on the LLM being up** | Every new call site catches `LlmUnavailableError` and falls back to a deterministic rule with `degraded=true` persisted. T11 → static template; T12 → templated narrative; T15 → return the validation/DB error honestly; T16 → keyword-only flag at `risk_level='medium'`, `llm_assessment=null`, `degraded_count++`. |
| **C-B1 / C-B3** | Every money-moving or customer-messaging step is an `actions` row *before* execution, with `bounds` listing every guardrail evaluated (pass **and** fail). Stopping rules live in code, not prompts. |
| **C-D1/D2/D3/D5** | T14 signatures use `crypto.timingSafeEqual` over equal-length buffers, never `===`. No secrets committed (`X402_SIM_SECRET` goes in `.env.example` as a placeholder). Simulation/chaos routes stay gated on `NODE_ENV`. |
| **C-D4 / C-D7** | Masked PII only in prompts, packets and logs (`llm/mask.ts`, `maskContact`). T15's schema doc must **omit** PII columns; the readonly role already lacks `customers.email`/`contact` and `payments.email`/`contact` — let the DB error surface verbatim rather than pre-filtering. |
| **C-G2 / C-G3** | Real pasted command output in `HANDOFF15.md`. Update `Flow.md`, `Bug-Feature.md`, `TestChecklist.md`, `Decisions.md` in the same task. |

---

## 2. Schema and contract facts you must not re-derive

Verified against `db/migrations/0001_init.sql` on 2026-09-05 — **every table this sprint needs already exists. Do not add columns or rewrite projections.**

- `subscriptions.salvage_state` (`none|retry_scheduled|retrying|offer_sent|recovered|churned|escalated`), `retry_count`, `next_retry_at`, `notes` — T10.
- `invoices.negotiation_state` (`none|offer_sent|countered|accepted|rejected|expired|escalated`), `negotiation_round`, `current_offer_paise`, `floor_amount_paise`, `line_items` — T11.
- `evidence_packets` (`dispute_id` UNIQUE, `packet`, `narrative`, `review_status` default `requires_human_review`) — T12.
- `ledger_entries` (`account, debit_paise, credit_paise, ref_type, ref_id, memo`) — T13/T14. **No unique index yet**; T13.1 must add one.
- `x402_payments` (`nonce` UNIQUE, `status challenged|verified|settled|rejected|expired`, `expires_at`, `reject_reason`, `payment_payload`) — T14.
- `nl_queries` (`question, generated_sql, validated, validation_errors, executed, row_count, latency_ms, provider, model, degraded, summary, error`) — T15.
- `products`, `compliance_scan_runs`, `compliance_flags` — T16.

**Blocking checklist correction — migration numbering.** The checklist text says T13 adds `0003_ledger_unique.sql` and T14 adds `0004_x402_indexes.sql`. `0003_projection_guards.sql` already exists. Use **`0004_ledger_unique.sql`** (T13) and **`0005_x402_indexes.sql`** (T14, only if an index is genuinely needed — `nonce` is already UNIQUE). Every migration needs its `.down.sql`. Record this correction in `Bug-Feature.md` → Deviations (it is a checklist typo, not a design change).

**Contracts already in the tree (`apps/api/src/orchestrator/types.ts`) — match them exactly, do not fork them:**

```ts
ActionModule { name; version; handles: string[]; canHandle(ctx); propose(ctx): Promise<ActionProposal|null>;
               guard(proposal, ctx): GuardResult; execute(action, ctx, deps): Promise<ExecutionResult>; compensate?(action, deps) }
ExecutionResult { status: 'executed'|'failed'; result: Record<string,unknown>; outbound?; ledger?; error? }
ActionProposal  { module, moduleVersion, idempotencyKey, entityType, entityId, customerId?, kind, summary,
                  moneyImpactPaise, expectedRecoveryPaise, requiresApproval, payload, ... scheduleFollowUp? }
```

Facts that will bite you if you ignore them:

1. **`money_impact_paise > 0` throws** (`db/repos/actions.ts:33`). Spend is negative, credits are never actions. T11's `moneyImpactPaise = -(amount - offer)` is correct; T10/T12 use `0`.
2. **`scheduleFollowUp` is already wired.** `execute.ts:132 followUpFromProposal` reads `proposal.scheduleFollowUp = { kind, payload, runAt, dedupeKey }` and enqueues it **only after a successful execution**, in the same transaction. T10 and T11 must use exactly this shape rather than enqueuing themselves.
3. **`module.execute` runs outside every row lock** (`execute.ts:69`), holding only a session advisory lock keyed by action id (D-049). So a module that writes with `deps.db` writes *non-atomically*. **T10 and T11 must not update `subscriptions`/`invoices` with `deps.db` directly.** Extend `ExecutionResult` with a bounded, declarative field and let `executeAction` apply it inside its second transaction, alongside the outbound message, ledger entries, follow-up job and action status:

   ```ts
   // orchestrator/types.ts — add, then mirror in Architecture.md §5
   export interface EntityStateUpdate {
     readonly table: 'subscriptions' | 'invoices' | 'disputes';   // closed set; never interpolated from module input
     readonly id: string;
     readonly set: Record<string, string | number | boolean | null>;  // whitelisted column names per table
     readonly expect?: Record<string, string | number | null>;        // optimistic guard, e.g. { salvage_state: 'none' }
   }
   ExecutionResult { …; entityUpdates?: readonly EntityStateUpdate[] }
   ```

   In `execute.ts` phase 2, apply each update with `SELECT … FOR UPDATE` on that row **after** the `actions` row is already locked (this is the documented C-C3 extension), fail the execution if `expect` does not match, and build the SQL from a per-table column allowlist — never from raw keys. **Add a `Decisions.md` entry for this contract change and update `Architecture.md §5`.**
4. **`onProposed` hook (T12.4).** `propose` must stay side-effect free. Add the optional `onProposed?(action: ActionRow, ctx: EventContext, db: Db): Promise<void>` to `ActionModule`, call it from `EventOrchestrator` immediately after `persistProposal` returns a row (and **not** for the duplicate-key path), and use it in T12 to insert the `evidence_packets` row. Mirror it in `Architecture.md §5`.
5. **`handleSynthetic` (T10.4) does not exist.** Add it to `EventOrchestrator` as a small entry point that takes `{ kind: 'dunning_step', subscriptionId }`, loads the current entity snapshot, and reuses the *same* `propose → guard → persistProposal → executeAction` path — including guardrails and the action audit trail. It must not open a transaction around a model call and must not bypass `orchestratorRules`.
6. **Routing.** `orchestrator/routing.ts` already routes every event this sprint needs (`subscription.pending|halted` with `diagnose: true`; `invoice.expired|paid|updated`, `payment.dispute.*` with `diagnose: false`). Modules are selected by `handles.includes(event_type) && canHandle(ctx)` and only run when `entity.applied` is true. Do not add routes for events that are already there; do not set `diagnose: true` on invoice/dispute events (T11 and T12 use their own drafting prompts, not the diagnostician).
7. **Guardrail keys** (`guardrails/types.ts`, seeded): `auto_approve_limit_paise`, `max_discount_pct`, `max_negotiation_rounds`, `max_dunning_retries`, `dunning_schedule_hours`, `message_cooldown_hours`, `quiet_hours_local`, `kill_switch`, `attribution_window_hours`, `x402_max_amount_paise`, `x402_daily_cap_per_payer_paise`, `daily_discount_budget_paise`. Read them through `loadGuardrailConfig`; never hardcode a bound in a module.
8. **Vitest against the shared database** stays `--no-file-parallelism --maxWorkers=1` (D-047).

---

## 3. The seven tasks

Follow `Checklist.md §Task 10` … `§Task 16` step by step — the steps below are the corrections and risks I want addressed, **not** a replacement for the checklist.

### T10 — SubscriptionSalvager (`feat(t10): subscription salvager dunning state machine`)
- `state.ts` transition table must be exhaustive and pure, including the documented exception: terminal states return `null` for everything **except** `payment_succeeded` on `churned → recovered`, which is allowed and logged.
- Retry outcomes come from `subscriptions.notes.sim_retry_outcomes[step]`, else `retry_failed`. Deterministic only — no randomness anywhere.
- T10.5 (`subscription.charged|activated`): cancel pending `dunning_retry` jobs by `dedupe_key` prefix (`status='cancelled'`, add the repo function), credit `recovered_revenue`, write a `salvage_recovered` action with money impact `0`.
- State writes go through `entityUpdates` (§2.3), with `expect` on `salvage_state`/`retry_count` so a concurrent step cannot double-advance.
- Tests: exhaustive transition table; max retries → `churned`; recovery cancels queued jobs; **re-running the same step is idempotent** (same `idempotencyKey` → one action row, one message).

### T11 — B2BNegotiator (`feat(t11): bounded b2b negotiator`)
- `pricing.ts` is pure integer paise with `Math.ceil` toward the merchant; unit-test both clamps (`floor`, `max_pct`) and assert `clampedBy` is reported.
- The model writes **only** `{ subject, body }` with `{{OFFER_AMOUNT}}` and `{{VALID_UNTIL}}` placeholders enforced by a zod `.refine`; code substitutes the numbers afterwards. A model-authored number is a review failure.
- LLM call sits outside every transaction. LLM down → static template, still bounded, `degraded` recorded.
- `requiresApproval = discountPct >= 10`; the orchestrator's own limit still applies on top.
- Counter below floor → `rejected` + an `ESCALATE_HUMAN` action at `pending_approval` (a human may override the floor — that override must be recorded, never silent).

### T12 — ChargebackEvidence (`feat(t12): chargeback evidence assembler with human review`)
- `assemble()` is deterministic SQL only. It reads `disputes → payments → orders → customers` — **in that order** (C-C3) if it takes any locks; plain `SELECT`s are fine.
- `missing[]` is the honest exception list. An empty `missing` on a packet that is actually incomplete is a review failure.
- `requiresApproval` is **always** `true`. `execute` must refuse unless `evidence_packets.review_status === 'approved'`.
- The packet sent to the model is masked (`id_masked`, no raw contact/email).
- Use the new `onProposed` hook (§2.4) to insert the packet — `propose` still writes nothing.

### T13 — Approvals API + attribution + metrics (`feat(t13): approvals, attribution ledger and metrics`)
- **Reuse `orchestrator/execute.ts:executeAction`** for the approve path. Do not write a second execution path — the advisory lock is what makes the concurrent double-click test pass.
- `POST /api/v1/actions/:id/decision`: `FOR UPDATE`, assert `pending_approval`, audit row, `409` if not pending. Two parallel approvals → exactly one `200`, one `409`, and exactly one execution.
- Migration **`0004_ledger_unique.sql`**: unique index on `(account, ref_type, ref_id)` so attribution can never double-count. Ship the `.down.sql`.
- Attribution window comes from `attribution_window_hours`; never attribute the same payment twice.
- `GET /api/v1/metrics/summary` numbers must reconcile against direct SQL in the test, not against themselves.
- Note for the metrics/ledger work: `guardrails/rules.ts:96 dailyDiscountSpent` buckets "today" with `date_trunc('day', $1::timestamptz)`, which follows the **database session timezone**, while `quietHours` resolves an explicit IANA zone per country. If T13 introduces a merchant-local day anywhere, make the two agree and record the choice in `Decisions.md`. Do not change guardrail semantics silently.

### T14 — x402 gateway (**major standalone feature**) (`feat(t14): x402 gateway with simulated facilitator`)
- Wire shapes in `Checklist.md §14` are exact — the 402 body, the `X-PAYMENT` header, `X-PAYMENT-RESPONSE`, and every rejection reason string. A demo client will read them literally.
- `canonical.ts` (`[nonce, amount, asset, payTo, payer, issuedAt].join('|')`) gets its own unit test. HMAC comparison uses `crypto.timingSafeEqual` on equal-length buffers (**C-D1**).
- The whole verify-and-settle path is one transaction with `SELECT … FOR UPDATE` **by nonce** — status/expiry/amount/signature/policy caps/kill switch — then `settled` + ledger `x402_revenue` credit + audit + `x402.settled`. **No model call anywhere in this path.**
- Required tests: happy path; replay → `nonce_already_settled`; expired nonce; tampered amount → `bad_signature`; over per-request cap; over payer daily cap; **two concurrent settlements of one nonce → exactly one settled**; kill switch → `503 gateway_paused`.
- `scripts/x402-buy.ts` with `--replay` and `--amount` is part of the deliverable (it is the demo).
- `X402_SIM_SECRET` and `X402_PAY_TO` go in `config.ts` and `.env.example` as placeholders.

### T15 — Ask Aegis (**major standalone feature**) (`feat(t15): text-to-sql sandbox and deterministic forecaster`)
- Add `pgsql-ast-parser`; record the dependency in `Decisions.md` (**C-D6**: no hosted services — this is a local parser, which is fine).
- `validator.ts` is the security boundary: exactly one statement; `select` only (CTEs allowed if all `select`); table allowlist; no `pg_catalog`/`information_schema`; function denylist; no `INTO`; then wrap `SELECT * FROM (<sql>) AS q LIMIT 200`.
- Execute on the **readonly pool** inside a transaction with `SET LOCAL statement_timeout = '5000ms'`. The readonly role cannot read `customers.email`/`contact` or `payments.email`/`contact` — if generated SQL touches them, return the DB error verbatim with `executed=false`. Do not widen the grants (**C-D7**).
- The generated SQL is **always** shown to the user, valid or not, and always persisted to `nl_queries`.
- `forecast.ts` is pure TypeScript (OLS + MA7, `±1.0·stddev(residuals)`) unit-tested against a hand-computed fixture. No model-produced numbers.
- Required rejection tests: `UPDATE`, `DELETE`, `;` chains, `pg_sleep(1)`, `information_schema.tables`; plus accepted joins and CTEs.

### T16 — Compliance scanner (**major standalone feature**) (`feat(t16): compliance scanner`)
- Rubric categories and the zod schema are fixed in `Checklist.md §16` — use them verbatim.
- Deterministic keyword prescreen runs **first**; the model runs at `tier: 'fast'` on the description only (no PII).
- `verifyEvidenceSpan`: case-sensitive `description.includes(span)`. Fabricated span → `status='needs_review'` with a note (**C-A3**). Keywords hit a category but the model says `none` → `needs_review` as well.
- One flag per product per run; run counters updated; LLM down → keyword-only flag at `risk_level='medium'`, `llm_assessment=null`, `degraded_count++`.
- Routes `POST /api/v1/compliance/scan`, `GET /api/v1/compliance/flags?status&risk`, `POST /api/v1/compliance/flags/:id/status`, worker handler `compliance_scan`, optional 6 h enqueue behind `AEGIS_COMPLIANCE_CRON=true`.

---

## 4. Before you hand back

Run these yourself and paste the **real** output into `HANDOFF15.md` (C-G2 — "should work" is not evidence):

```bash
pg_isready
pnpm db:status                                   # after the new migrations: 0004 (and 0005 if added) applied, pending: (none)
pnpm db:migrate:down && pnpm db:migrate          # prove the new down-migrations actually reverse
pnpm --filter @aegis/api exec vitest run src/modules src/x402 src/nlq src/compliance src/orchestrator test/ --no-file-parallelism --maxWorkers=1
pnpm typecheck && pnpm test && pnpm lint
pnpm x402:buy <productId> ; pnpm x402:buy <productId> --replay
```

Then update, in the same run: `Flow.md` (F5, F6, F7, F8, F9 → live), `Bug-Feature.md` (F-012 … F-018 → `implemented`, plus any new `B-0NN` and the migration-numbering deviation), `TestChecklist.md` (a real section per task), `Decisions.md` (`entityUpdates` contract, `onProposed` hook, `pgsql-ast-parser`, any day-boundary decision), `Architecture.md §5` (contract changes) and `§13` (status rows), and `Checklist.md` (tick 10.1 … 16.4).

`HANDOFF15.md` must state, per task: green or not, the commit hash, what deviated, and anything you could not finish. Do not report a task complete unless its tests ran green in front of you.

---

## 5. What verification will check (so you can pre-empt it)

1. **Grep every `withTransaction` / `BEGIN` site for a model call.** Expected result: zero. This is the fastest way to fail this sprint.
2. **Per-file lock sequences** against `disputes → payments → orders → customers` (+ `subscriptions`/`invoices` above `customers`, + the `actions → entity` extension). Any new `SELECT … FOR UPDATE` on an absent row that is treated as a reservation is a bug (B-007's exact shape).
3. **Every new concurrency assertion re-read for vacuity** — the T5 lesson: a green check whose fixtures make failure impossible proves nothing. The x402 double-settlement test and the T13 double-click test must actually contend on the same row, and must fail if the lock is removed.
4. **`bounds` completeness** on every persisted action (C-B1): every guardrail evaluated, passing ones included.
5. **Fallback paths exercised**, not just declared: a test per model call site with the LLM down.
6. **Docs actually updated**, and `.env.example` free of real secrets.
