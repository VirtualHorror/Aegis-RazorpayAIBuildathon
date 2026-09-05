# Constraints — what must NEVER happen in Aegis

> Binding on every agent (Claude, Codex, humans). The Verification Agent rejects any task that violates a line here.
> Each rule has an ID so reviews and `Bug-Feature.md` can cite it.

## A. AI boundary (the "AI judgement" bar)

- **C-A1** Never use the LLM for arithmetic, money, dates, or any value that ends up in a ledger, a price, a discount, a retry count, or a schedule. Numbers are computed in TypeScript, unit-tested, and *injected* into any LLM-drafted text afterwards.
- **C-A2** Never let free-form LLM output drive control flow. Every LLM call goes through `LlmClient.completeJson` with a zod schema; only enum values and bounded strings cross the boundary.
- **C-A3** Never trust an LLM classification without a deterministic cross-check (`diagnosis/cross-check.ts`, `compliance` evidence-span check). Overrides are recorded, not silent.
- **C-A4** Never let the system depend on an LLM being up. Every LLM call site must catch `LlmUnavailableError` and fall back to a deterministic rule with `degraded=true` recorded.
- **C-A5** Never let the LLM write customer-facing copy for regulated/templated channels (WhatsApp retry links use pre-approved templates). LLM text is allowed only for B2B negotiation drafts, evidence narratives, and dashboard summaries, and is labelled as AI-generated.
- **C-A6** Never call an LLM from inside a database transaction that holds row locks. Call the LLM, then open the transaction.
- **C-A7** Never send PII (email, phone, full name) to an LLM. Mask before prompting (`maskContact`, `maskEmail`).
- **C-A8** Never execute AI-generated SQL outside the read-only role, without AST validation, without a statement timeout, or without a row limit.

## B. Money and actions (the "explainable, bounded, gated" bar)

- **C-B1** Every action that could move money or message a customer is an `actions` row **before** it is executed, with `bounds` listing every guardrail evaluated (pass and fail).
- **C-B2** Money impact above `auto_approve_limit_paise` is `pending_approval`; nothing executes without a human decision recorded in `audit_log` with `decided_by`.
- **C-B3** Discounts never exceed `max_discount_pct` or go below `invoices.floor_amount_paise`; negotiations stop after `max_negotiation_rounds`; dunning stops after `max_dunning_retries`; the daily discount budget is a hard stop. Stopping rules live in code, not prompts.
- **C-B4** Chargeback evidence is **never auto-submitted**. `review_status` must pass through `approved` by a human.
- **C-B5** `kill_switch = true` must block every module and the x402 gateway within one poll cycle. No cached bypass.
- **C-B6** Amounts are integer paise (`bigint` in PG, `number` in TS with `assertSafePaise`). Never floats for money; never format money in the API (formatting is a UI concern).
- **C-B7** No real outbound side effects: WhatsApp, x402 settlement, and Razorpay API calls are simulated, and the simulation is labelled as such in payloads (`network: "aegis-sim"`, `status: "simulated_sent"`).

## C. Idempotency, concurrency, state

- **C-C1** Never process a webhook without first persisting it idempotently on `webhook_events.event_id`. The ingress path is: verify signature → upsert event → enqueue job in the same transaction → 200. An unverified delivery must never occupy a key a verified delivery could use: `x-razorpay-event-id` is untrusted until the HMAC passes, so rejected deliveries are keyed into the `unverified:<sha256(raw body)>` namespace (D-031).
- **C-C2** Never skip the idempotency check "because it's a simulation". Duplicates must be answered `200 {"status":"duplicate"}` and counted.
- **C-C3** Never update an entity projection without `SELECT … FOR UPDATE` and the precedence rule (`shouldApplyPaymentTransition`, `isStaleSubscriptionEvent`).
- **C-C4** Never dequeue jobs without `FOR UPDATE SKIP LOCKED`; never lose a job on crash (outbox + sweeper).
- **C-C5** Never hardcode mock data where a DB call is required. Fixtures live in `db/seed` and test files only; API responses always come from PostgreSQL.
- **C-C6** Never use in-memory state as the source of truth (the SSE bus is a notification channel, not storage).

## D. Security and data

- **C-D1** Never compare signatures with `===`. Use `crypto.timingSafeEqual` on equal-length buffers.
- **C-D2** Never verify a signature against a re-serialised body. Use the raw request bytes.
- **C-D3** Never commit secrets. `.env` is gitignored; `.env.example` has placeholders only. The Verification Agent greps for `sk-`, `whsec_`, `postgres://…:…@` in diffs.
- **C-D4** Never log full PII. Pino redaction paths cover `email`, `contact`, `phone`, `card.number`.
- **C-D5** Never mount simulation/chaos routes in production mode.
- **C-D6** Never use external BaaS (Supabase, Firebase, Upstash, hosted queues). Local PostgreSQL only. No Docker required to run.
- **C-D7** Never widen the read-only role's grants to PII columns.

## E. Code quality (the "would you trust it" bar)

- **C-E1** Comment every non-obvious block with **intent** and **flow** (`// Intent: … // Flow: …`). State machines get a transition table comment. Guard rules explain the bound they enforce.
- **C-E2** No `any`, no `// @ts-ignore`, no `as unknown as`. `tsc --noEmit` must pass with `strict: true`.
- **C-E3** No silent `catch {}`. Every catch logs with context or rethrows a typed error.
- **C-E4** No new dependency without a `Decisions.md` entry. Pin exact-ish versions (`~` or exact) in `package.json`.
- **C-E5** Tests are part of the task: state machines, bounds math, idempotency and precedence rules need unit tests; ingress/worker/x402 need integration tests against `aegis_test`. A task without its tests is not done.
- **C-E6** Files stay focused: a module = one directory with `index.ts` (ActionModule), `rules.ts` (pure guards), `state.ts` (transitions), `templates.ts`, `*.test.ts`. Split anything over ~300 lines.
- **C-E7** No console.log in library code; use the injected logger.
- **C-E8** No `TODO` left in a completed task. Either do it or record it in `Bug-Feature.md`.

## F. Frontend

- **C-F1** Every page renders the footer text exactly: `Made with 💖 by Nabhanyu for Razorpay AI Buildathon`.
- **C-F2** Theme: system preference by default, manual Dark/Light toggle persisted in `localStorage`, no flash of wrong theme (class strategy via `next-themes`, `suppressHydrationWarning` on `<html>`).
- **C-F3** Responsive from 360px to 1920px; no horizontal page scroll; tables scroll inside their container.
- **C-F4** Motion respects `prefers-reduced-motion`; WebGPU effects feature-detect `navigator.gpu` and fall back to Canvas 2D / SVG; the app must render on a VM without a GPU.
- **C-F5** No data is faked in the UI. Empty states are real empty states.
- **C-F6** Accessible: keyboard-reachable controls, visible focus rings, colour contrast ≥ 4.5:1 for text in both themes, `aria-live` on the live feed.

## G. Process

- **C-G1** One checklist task per handoff. Do not start the next task. Do not "also fix" unrelated code.
- **C-G2** Before claiming done: run the task's commands in `TestChecklist.md` and paste real output into `HANDOFF*.md`. No "should work".
- **C-G3** Update `Flow.md`, `Bug-Feature.md`, `TestChecklist.md` (and `Decisions.md` if a decision was made) in the same task.
- **C-G4** Commit at the end of every task with a conventional-commit message: `feat(scope): …` / `fix(scope): …` / `docs: …`. Never commit `.env`, `node_modules`, `.next`, `pg_data`.
- **C-G5** If a step in the checklist is impossible or wrong, stop, record it in `Bug-Feature.md` under "Deviations", and say so in the handoff. Do not silently substitute.
