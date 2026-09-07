# Handoff: Aegis — Sprint 2 verified GREEN, Sprint 3 (frontend, T17–T22) shipped

**Generated**: 2026-09-06 02:55 IST
**Branch**: `main` (HEAD `4db15b2`)
**Status**: Ready for Review — T1–T22 done; T23 (demo storyboard) is next and unblocked

> `HANDOFF16.md` is the formal task handoff (evidence, commands, tags). **This file is the session handoff**: what
> happened, the traps, and how to resume. Read `AGENTS.md` → `Constraints.md` → `Checklist.md §23` before touching code.

## Goal

Aegis is a Razorpay-Buildathon payments-recovery control plane; `Checklist.md` drives 24 tasks. This session had two
parts: (1) lightning-verify Codex's Sprint 2 (T10–T16) on two specific questions, then (2) take over as Lead Frontend
Developer and build T17–T22 continuously, ending with a dashboard ready to record a demo against.

## Completed

- [x] **Part 1 — T10–T16 verified GREEN** (`0187b02`). Migrations `0001`–`0004`, each with a down file, no colliding
      prefix. All 30 `SELECT … FOR UPDATE` sites read: no model call inside any lock-holding transaction (C-A6 holds).
      Tags `task-10-done` … `task-16-done` moved onto the verification commit.
- [x] **T17 web shell** (`c3adf2d`) — tokens, app shell, theme toggle, footer in the root layout, typed API client,
      shared SSE store, `GlowInput`, `/kitchen-sink`.
- [x] **T18 overview + events** (`8fbc80d`) — live KPI/money/model-health tiles, prism placeholder, live events feed,
      `HalftoneField`.
- [x] **T19 actions + approvals** (`de7a883`) — audit table, drawer, full action page, bounds checklist, diagnosis card,
      SIMULATED payload watermark, two approval queues with required notes and 409 handling.
- [x] **T20 ask + compliance** (`8daa211`) — Text-to-SQL composer with the SQL always visible, hand-rolled forecast
      chart, flag list with verbatim evidence highlighting.
- [x] **T21 x402 lab + settings + entities** (`994046b`) — three-step live x402 exchange, guardrail form, kill switch,
      change history, subscriptions/invoices tables.
- [x] **T22 prism hero + polish** (`9b42eb2`) — `prismGeometry` (tested), `prism.wgsl` through vgpu, Canvas 2D fallback,
      accessibility pass to Lighthouse 100.
- [x] Seven real bugs found and fixed with regression tests: **B-012**–**B-018** (table in `Bug-Feature.md`).
- [x] Full gate green at HEAD: shared 47, web 45, api 219 tests; typecheck, lint and `next build` (13 routes) all clean.

## Not Yet Done

- [ ] **T23** — demo storyboard (`scripts/demo.sh` is still a placeholder that exits 2), README rewrite, video plan.
- [ ] **T24** — hardening: security review, failure drills, final test pass.
- [ ] Prove the WebGPU prism path on hardware with a real adapter (see Warnings).
- [ ] Reset `quiet_hours_local` to `{start: 21, end: 8}` before recording if you want message suppression on camera.

## Failed Approaches (Don't Repeat These)

**Shell working directory drifts and silently writes files to the wrong place.** Twice, a `cd apps/web` inside one
`Bash` call persisted, so a later `cat > apps/web/src/...` heredoc created `apps/web/apps/web/src/...` (once it failed
loudly with "No such file or directory", once it succeeded and the tests reported "No test files found"). Always use
absolute paths in heredocs, or `cd /home/nabhanyu/Downloads/RazorpayAIBuildathon &&` first.

**`Date.now()` and ref writes during render fail `pnpm lint`.** `eslint-config-next` enforces React 19 purity:
`react-hooks/purity` rejects `const now = Date.now()` in a component body, and `react-hooks/refs` rejects
`someRef.current = value` outside an effect. Also `react-hooks/set-state-in-effect` rejects `setState` called
synchronously in an effect. Fixes that pass, all in the tree now: a shared clock store (`lib/useNow.ts`) read through
`useSyncExternalStore`; ref writes moved into `useEffect`; feature detection through `useSyncExternalStore` instead of
detect-then-setState.

**Passing column `render` functions from a server component to a client table.** `/subscriptions` and `/invoices`
returned 500 with `Error: Functions cannot be passed directly to Client Components unless you explicitly expose it by
marking it with "use server"`. Column definitions now live inside `SubscriptionTable` / `InvoiceTable`, which are
`"use client"`; the pages pass plain rows.

**Fetching compliance product copy from `/x402/catalog`.** Every flag rendered "Product copy is not in the agent
catalog" because that route filters `agent_purchasable = true` and all five risky seed products are `false`. The flag
routes now join `products` and return the copy with the flag (B-015, D-066).

**Trusting a route that returns "the same row" to return the same shape.** `POST /api/v1/compliance/flags/:id/status`
answered with `RETURNING *` from `compliance_flags` alone, so replacing the row in state dropped `product_description`
and crashed with `TypeError: Cannot read properties of undefined (reading 'indexOf')`. Both routes now return the joined
shape.

**`/// <reference types="@vgpu/wgsl/wgsl-types" />` with vgpu installed alone.** `TS2307: Cannot find module
'./prism.wgsl'` — pnpm's isolated `node_modules` does not expose the transitive `@vgpu/wgsl`. Fixed by adding
`@vgpu/wgsl@0.4.0` as a direct devDependency of `apps/web`.

**Approving vgpu's native build scripts.** `@vgpu/adapter-node` and `webgpu` build Dawn for headless Node rendering,
which nothing here uses. They are denied in `pnpm-workspace.yaml` (D-069). Note pnpm rewrites that file and appends
`'@vgpu/adapter-node': set this to true or false` placeholder lines, which then break YAML with `duplicated mapping key`
— delete the placeholders after any `pnpm add` that pulls a native dep.

**Labels pinned to the prism fan's ray ends.** The fan sweeps with the pointer, so a label fixed at a ray's endpoint
soon names the wrong colour, and the lowest labels collided with the counters. Replaced with a right-hand legend with
colour swatches that lights per module (recorded as a deviation in `Design.md §9`).

**Claiming T17 green after running only focused tests.** `pnpm --filter @aegis/api exec vitest run src/routes/system.test.ts`
passed while `apps/api/test/app.test.ts` still asserted the old `/api/v1/system` shape; the next full gate failed with
`expected { provider: 'stub', …(5) } to deeply equal { provider: 'stub', …(2) }`. Run the whole gate before tagging.

**`resize_window` above 768×583 on this VM.** Chrome answers `Invalid value for bounds. Bounds must be at least 50%
within visible screen space.` Responsive checks were done by injecting a same-origin `<iframe>` at the target width and
reading `document.documentElement.scrollWidth` inside it.

## Key Decisions

| Decision | Rationale |
|---|---|
| Bus event names moved to `@aegis/shared` (D-059) | `EventSource` needs one listener per name and has no wildcard; a rename now fails typecheck in both packages |
| `/api/v1/system` carries `env`, `version`, `simulated` (D-060) | Checklist 17.3 wants env in the pill; keeps the route DB-free and credential-free |
| No SWR/React Query; pages merge SSE into local state (D-061) | The durable truth is PostgreSQL and is refetched on reconnect; a cache layer would add a second source of truth |
| Hand-drawn SVG icons, no icon package (D-061) | C-E4: a dependency per glyph is not worth it |
| Merchant invoice floor read from `notes.floor_amount_paise` (D-063) | The only honest source for a money bound; absent/invalid falls back to `floor = amount`, which permits no discount |
| Actor name in `localStorage`, default `human:dashboard` (D-064) | Decisions must be attributable (C-B2) without pretending to be authentication |
| One hand-rolled forecast chart, no chart library (D-065) | ~120 lines, theme tokens directly, numbers repeated in a table |
| Server signs the x402 header via a dev-only route (D-067) | The facilitator secret never reaches the browser (C-D3); the Lab still drives the real gateway |
| Guardrail money typed in rupees, stored in paise by string arithmetic (D-068) | No `parseFloat * 100` anywhere near a money bound (C-B6) |
| `.wgsl` as a real file with vgpu's Turbopack loader (D-070) | Checklist 22 asks for it; makes `vgpu check` possible |
| `--on-accent` token (D-071) | White on the dark-mode accent measures 3.13:1; C-F6 needs 4.5:1 |

## Current State

**Working**: everything. Eleven routes plus `/kitchen-sink`, all rendering the required footer. Live SSE across
overview, events, actions, approvals, x402 and the kill-switch pill. Verified in Chrome this session: the full demo run,
an approval that executed, an Ask Aegis query answered by the live proxy model, a validator refusal, a compliance scan
that flagged five products, the three-step x402 exchange, a guardrail edit, and the kill switch propagating live.

**Broken**: nothing known. Two environmental limits, not defects — see Warnings.

**Uncommitted Changes**: none. `git status` shows only untracked `HANDOFF*.md` files from earlier sessions.

**Running processes** (started this session with `setsid nohup`, logs in the scratchpad):

| Port | What | Restart |
|---|---|---|
| 4000 | `pnpm --filter @aegis/api dev` | `ss -ltnp \| grep :4000` → `kill -TERM <pid>`, then restart |
| 3000 | `pnpm --filter @aegis/web dev` | same with `:3000` |

Kill by PID from `ss`, never `pkill -f` (it once matched and killed the tool shell).

## Files to Know

| File | Why It Matters |
|---|---|
| `apps/web/src/lib/api.ts` | Every API call. Returns a discriminated result, never throws, so pages render honest offline states |
| `apps/web/src/lib/sse.ts` | One `EventSource` per tab shared by all hooks; owns the 1 s→10 s backoff |
| `apps/web/src/lib/types.ts` | Wire types for every row the UI renders; a renamed API column fails typecheck here first |
| `apps/web/src/components/prism/prismGeometry.ts` | The only source of the prism scene; both renderers consume it |
| `apps/web/src/components/prism/PrismHero.tsx` | The whole hero: a static SVG prism, no GPU path (D-086) |
| `apps/api/src/routes/approvals.ts` | Actions, events, approvals, guardrails and the guardrail history; holds `cursorOf` (B-012) |
| `apps/api/src/routes/sim.ts` | `/sim/run` and the dev-only `/sim/x402-sign`; not mounted in production |
| `apps/api/src/orchestrator/projections/invoices.ts` | `merchantFloorPaise` — the fix that made the negotiator demonstrable |
| `apps/api/test/approvals.integration.test.ts` | 10 tests; the regression home for B-012, B-013, B-015, B-017 and x402 signing |
| `Bug-Feature.md` | Feature/bug/deviation ledger plus the 2 AM log (entries 13–17 are this session) |

## Code Context

**SSE hooks** (`apps/web/src/lib/sse.ts`):

```typescript
function useEventStream(names?: readonly BusEventName[]): { events: StreamEvent[]; status: StreamStatus; latest: StreamEvent | undefined }
function useStreamEffect(names: readonly BusEventName[], handler: (event: StreamEvent) => void): void  // no re-render
function useStreamStatus(): "connecting" | "live" | "reconnecting"
```

**API result type** (`apps/web/src/lib/api.ts`) — every call returns this, so pages branch instead of catching:

```typescript
type ApiResult<T> = { ok: true; status: number; data: T; headers: Headers }
                  | { ok: false; status: number; error: string; details?: string; body?: unknown; headers?: Headers };
```

**Prism scene** (`apps/web/src/components/prism/prismGeometry.ts`):

```typescript
function prismGeometry(input: { width: number; height: number; pointer?: Point | null }): PrismScene
// PrismScene: { triangle: [Point, Point, Point]; entry, internal, exit, specular: Segment;
//               fanRays: { angle, module, color, from, to }[]; exitPoint: Point }
```

**Merchant floor** (`apps/api/src/orchestrator/projections/invoices.ts`) — fails closed:

```typescript
function merchantFloorPaise(notes: unknown, amountPaise: number): number
// notes.floor_amount_paise must be a safe integer in [0, amount]; anything else returns amountPaise (no discount room)
```

**x402 signing helper** (dev only):

```jsonc
// POST /api/v1/sim/x402-sign  { "nonce": "...", "amount": "49900", "payer": "agent:dashboard" }
// 200 → { "header": "<base64 X-PAYMENT envelope>", "payload": { ..., "signature": "0f2a1b3c…" } }
// The full signature and X402_SIM_SECRET never appear in the response.
```

**Non-obvious**: `lib/useNow.ts` returns `null` until hydration so server and client render the same absolute time,
then switch to "3m ago"; every element using it carries `suppressHydrationWarning`.

## Resume Instructions

1. Confirm the environment: `pg_isready` → `accepting connections`; `curl -s localhost:4000/api/v1/system` →
   `{"provider":"openai","model":"gpt-5.6-luna",...,"simulated":true}`. If either server is down, restart per the table
   above.
2. Re-run the gate before changing anything:
   `source ~/.nvm/nvm.sh && nvm use && pnpm typecheck && pnpm test && pnpm lint`
   - Expected: shared 5 files/47 tests, web 11 files/45 tests, api 48 files/219 tests, lint clean, exit 0.
   - If the API suite fails on a missing relation, another Vitest process is using `aegis_test`; run it alone.
3. Start T23 from `Checklist.md §23`. `scripts/demo.sh` currently prints "The demo storyboard is implemented in Task 23"
   and exits 2 — that is the file to write.
4. Before recording, put the guardrails back where a demo shows them working:
   - `curl -s -X PUT localhost:4000/api/v1/guardrails/quiet_hours_local -H 'content-type: application/json' -d '{"value":{"start":21,"end":8},"actor":"human:nabhanyu"}'`
   - Leave `auto_approve_limit_paise` at `200000` (₹2,000); an `invoice_expired_b2b` run then produces a ₹21,000 discount
     that lands in `/approvals`.
   - Verify: `curl -s -X POST localhost:4000/api/v1/sim/run -d '{"scenario":"invoice_expired_b2b"}' -H 'content-type: application/json'`,
     wait ~8 s, then `curl -s localhost:4000/api/v1/approvals | jq '.actions | length'` → `1`.
5. Optional clean slate for the catalog: `pnpm db:seed`, then click **Run scan** on `/compliance`.
   - Expected: 16 products scanned, 5 prohibited flags, `degraded_count 0`. The scan takes ~90 s (one model call per
     product); the page polls until it settles.

## Setup Required

- Node 24 via nvm (`source ~/.nvm/nvm.sh && nvm use`), pnpm 11. PostgreSQL 16 already bootstrapped.
- `.env` is present and gitignored. It now pins `OPENAI_MODEL=gpt-5.6-luna` and `OPENAI_MODEL_FAST=gpt-5.6-luna`;
  `.env.example` deliberately keeps the generic defaults. A backup of the pre-edit `.env` is in the session scratchpad.
- No test accounts: the dashboard has no login. The decision actor is a `localStorage` label, editable on `/approvals`
  and `/settings`.

## Edge Cases & Error Handling

- API unreachable → every page renders an honest empty state with the reason; the top bar shows "API offline". Nothing
  is faked (C-F5).
- Model provider down → diagnoses fall back to rules with `degraded=true`; the LLM pill reads `stub · degraded` or the
  provider name, and the model-health tile shows the degraded rate. This is the current default behaviour of the proxy
  for `gpt-5.6`, so it is easy to demonstrate.
- Two reviewers approving the same action → one gets 200, the other 409; the UI restores the row and says "Someone else
  decided this action first", then refetches.
- Clipboard blocked (insecure origin) → the copy button shows "Failed" rather than silently doing nothing.
- `localStorage` unavailable → the actor falls back to `human:dashboard`; decisions stay attributable.
- Reduced motion → prism draws one static frame, halftone draws one frame, the glow stops animating, rows do not slide.

## Warnings

- **WebGPU is no longer used anywhere.** Resolved on 2026-09-07 (D-086): the hero is a static SVG, `vgpu` and its
  WGSL loader are out of the project, and there is nothing left to feature-detect or validate. This VM's null
  `requestAdapter()` and DV-010 stopped mattering; the caveat is kept here only so the earlier handoffs read straight.
- **The model proxy is flaky.** `gpt-5.6` and `gpt-5.4-mini` return 503; only `gpt-5.6-luna|sol|terra` complete. If
  answers start coming back degraded, probe with a `curl` to `$OPENAI_API_BASE/chat/completions` before assuming a code
  problem.
- **Guardrails were changed during verification.** `quiet_hours_local` is `{start: 3, end: 4}` (so messages send rather
  than being suppressed) and `max_discount_pct` is back at 15. Both are visible in the change history on `/settings`.
- **`git status` shows five untracked `HANDOFF*.md` files** from earlier sessions (`HANDOFF.md`, `6`, `8`, `10`, `12`).
  They were deliberately left untracked; do not commit them without asking.
- **The x402 Lab and Run demo are dev-only.** Both call `/api/v1/sim/*`, which is not mounted when `NODE_ENV=production`;
  the buttons disable themselves and explain why.
