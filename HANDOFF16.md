# Handoff 16 — Sprint 3 (Tasks 17–22, frontend)

Generated: 2026-09-06
Branch: `main`
Author: Claude (Lead Technical Architect, acting as Lead Frontend Developer for this sprint, D-062)

## Part 1 — Sprint 2 verification (T10–T16): GREEN

Commit `0187b02`, tags `task-10-done` … `task-16-done` moved to it.

Two questions were asked of every changed file:

- **Migration numbering.** `db/migrations` holds `0001_init`, `0002_readonly_grants`, `0003_projection_guards`, `0004_ledger_unique`, each with a matching `.down.sql`. No duplicate prefix. The ledger migration is `0004` and x402 needed none (`x402_payments.nonce` was already unique) — the checklist's `0003`/`0004` labels are corrected in DV-009.
- **No model call inside a lock.** All 30 `SELECT … FOR UPDATE` sites were read. The lock-holding transactions in the new code are `compliance/scanner.ts:113-142`, `compliance/routes.ts:47`, `orchestrator/attribution.ts:38`, `x402/facilitator.ts:24`, `routes/approvals.ts:126,161` and `modules/subscription-salvager/index.ts:132`; none calls a model. The model calls sit in `propose()` (`b2b-negotiator:106`, `chargeback-evidence:49`), in `nlq/service.ts:110,149,175` before `executeReadonly` opens its transaction, and in `compliance/scanner.ts:63` before `upsertFlag` begins. C-A6 holds.

`pnpm typecheck && pnpm test && pnpm lint` exited 0 at that commit.

## Part 2 — Sprint 3: Tasks 17–22 done

| Task | Commit | Tag |
|---|---|---|
| T17 web shell | `c3adf2d` | `task-17-done` |
| T18 overview + events | `8fbc80d` | `task-18-done` |
| T19 actions + approvals | `de7a883` | `task-19-done` |
| T20 ask + compliance | `8daa211` | `task-20-done` |
| T21 x402 lab + settings + entities | `994046b` | `task-21-done` |
| T22 prism hero + polish | `9b42eb2` | `task-22-done` |

Final gate (`pnpm typecheck && pnpm test && pnpm lint && pnpm --filter @aegis/web build`) exits 0:

```text
packages/shared  5 files / 47 tests
apps/web        11 files / 45 tests
apps/api        48 files / 219 tests
lint: three projects clean
next build: 13 routes compiled
```

## What exists now

Eleven routes, every one rendering `Made with 💖 by Nabhanyu for Razorpay AI Buildathon` from the root layout: `/`, `/events`, `/actions`, `/actions/[id]`, `/approvals`, `/ask`, `/compliance`, `/x402`, `/settings`, `/subscriptions`, `/invoices`, plus `/kitchen-sink` for component review.

Live data throughout: one shared `EventSource` (`lib/sse.ts`, backoff 1 s → 10 s) drives the events feed, the overview counters, the approval queue, the x402 settlements and the kill-switch pill. Bus event names live in `@aegis/shared` (D-059).

Three flourishes per `Design.md` §5: `PrismHero` (vgpu WebGPU with an identical Canvas 2D fallback), `HalftoneField`, and `GlowInput`'s animated conic halo.

## Bugs found and fixed while building the frontend

| ID | What it was |
|---|---|
| B-012 | Every list route returned a `next` cursor its own `before` validator rejected, so no second page could load |
| B-013 | The model-health tile read "1 call, 100 % degraded" after 18 diagnoses: metrics counted providers, not calls |
| B-014 | Every simulated invoice had `floor = amount`, so the negotiator could never offer a discount and the approvals queue could never fill |
| B-015 | Acknowledging a compliance flag crashed the page; flags carried no product copy |
| B-016 | CORS advertised only `GET, HEAD, POST`, so the browser dropped every guardrail `PUT` and hid `X-PAYMENT-RESPONSE` |
| B-017 | Kill-switch changes never reached the event bus, so no dashboard saw the stop |
| B-018 | White on the dark-mode accent measured 3.13:1, under the 4.5:1 C-F6 requires |

Each has a regression test cited in `Bug-Feature.md`, and entries 13–17 of the 2 AM log tell the stories.

## Verified in Chrome, not asserted

Lighthouse accessibility, navigation mode: `/` desktop **100**, `/events`, `/approvals`, `/x402` mobile **100**, zero failed audits. No horizontal scroll at 360px on any page checked (`scrollWidth 342 ≤ innerWidth 357`). Theme choice survives reload with no flash. The full demo runs from the top bar and the pages fill in live.

The x402 Lab was driven end to end in the browser: 402 challenge → signed payment → 200 with a decoded `X-PAYMENT-RESPONSE` → `nonce_already_settled` on replay. Ask Aegis answered live through the proxy model, and `information_schema` was refused by the validator with nothing executed. The compliance scan flagged all five risky seed products with verbatim evidence spans.

## Could not be verified here

- **WebGPU.** This VM has `navigator.gpu` but `requestAdapter()` returns null, so the browser took the Canvas 2D path and logged why. The WebGPU path is therefore unproven on real hardware; the shader parses and reflects cleanly under `vgpu check`, but device validation is skipped for the same missing-adapter reason (DV-010). On a machine with a GPU, `NEXT_PUBLIC_PRISM_MODE=gpu` forces it.
- **The proxy model is unreliable.** `gpt-5.6` and `gpt-5.4-mini` answer 503; only the `gpt-5.6-luna/sol/terra` ids complete. `.env` now names `gpt-5.6-luna` (`.env.example` keeps the generic defaults). When the proxy fails, every diagnosis is a rule-based fallback and the dashboard says so.

## Next

Task 23 (demo storyboard, README, video plan) and Task 24 (hardening). Before recording: run `pnpm db:seed` if you want a clean catalog, start both servers, and note that `auto_approve_limit_paise` is back at ₹2,000 and `quiet_hours_local` is `{start: 3, end: 4}` from verification — set quiet hours back to `21-8` if the recording should show messages being suppressed.
