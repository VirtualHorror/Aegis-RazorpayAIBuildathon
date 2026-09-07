# Video storyboard — Aegis, 5:00

> Shot list for the submission video. Timestamps are the **video** clock. The middle act is `pnpm demo`, which runs in
> **1:45–2:30** depending on model latency, so it is recorded once and the video is cut to it — the demo prints its own
> elapsed clock in every step header (`STEP 6/13 [0:22]`), which is what the "demo clock" column refers to.

## Before recording

```bash
pnpm dev                      # both servers, in a separate terminal
pnpm db:seed                  # guardrails back to ₹2,000 / 15% / quiet hours 21:00–08:00
psql "$DATABASE_URL" -c "select count(*) from compliance_flags"   # optional: a clean slate reads better
```

- Record between **08:00 and 21:00 in the customer's timezone** (`Asia/Kolkata` for the pinned demo customer). Outside
  that window the recovery is correctly blocked by `quiet_hours_local` and step 10 has nothing to attribute. If you must
  record at night, run `pnpm demo --allow-quiet-hours` — it widens the window through the public guardrail API, says so
  on screen, and restores 21:00–08:00 on exit. **Do not** edit the database to fake it.
- Terminal at ~110 columns, large font. Browser on `http://localhost:3000` in a second window.
- Nothing to set for the hero: it is static SVG and records the same on any machine (D-086)
  and that is fine.
- One dry run first. The x402 per-payer daily cap is real (₹5,000/payer/day); `pnpm demo` uses a fresh payer per run,
  so repeated rehearsals do not trip it.

---

## Act 1 — The problem (0:00 – 0:45)

| Video | Shot | On screen | Say |
|---|---|---|---|
| 0:00 | Cold open | `/events` mid-stream, events arriving live | "This is a merchant's Razorpay webhook stream. Every one of these is something that went wrong: a 3DS decline, a subscription that stopped renewing, a B2B invoice that quietly expired, a chargeback with a seven-day clock on it." |
| 0:12 | Hold | the feed keeps moving | "Somebody has to read all of it, work out what each one means, and act before the money is gone. That is what Aegis does." |
| 0:22 | Cut to `docs/architecture.svg` | the system map, full frame | "One design decision runs through the whole system. The model is allowed to read language and pick from a closed set. It is never allowed to compute a number or decide control flow." |
| 0:33 | Point at the pink boxes | diagnostician, Ask Aegis, compliance | "Three places the model speaks. Everything pink is bounded by a zod schema and cross-checked. Every rupee, every retry count, every discount, every deadline is TypeScript — unit-tested, and injected into the model's sentence afterwards." |

## Act 2 — The demo (0:45 – 2:50)

Start `pnpm demo` at **0:45**. Keep the terminal on screen; cut to the dashboard where noted, and let the SSE feed do the work.

| Video | Demo clock | On screen | Say |
|---|---|---|---|
| 0:45 | `0:02` | `pnpm demo` · steps 1–2 | "Reset, then start the catalog compliance scan — sixteen products, one model call each. The control plane answers 202 and works in the background; we come back to it." |
| 0:57 | `0:09` | step 3, four deliveries | "A cross-border 3DS decline. Razorpay delivers it four times — one accepted, three duplicate. The idempotency key is the event id, and **only a signed delivery can claim one.** That was a real vulnerability; I will come back to it." |
| 1:12 | `0:13` | step 4 · **cut to `/events`** | "A UPI checkout abandoned. Pinned to one customer, because we are going to follow this person to the end of the story." |
| 1:22 | `0:18` | step 5 | "A subscription renewal halts. The dunning state machine schedules retries at 24, 72 and 168 hours, and then it stops. Those numbers are code. The model never picks a number." |
| 1:32 | `0:22` | step 6 · **cut to `/actions`** | "A B2B invoice expires and the negotiator drafts an offer. Watch what the demo does here — it does not tell you what happened, it **reads the action back**." |
| 1:45 | `0:35` | the read-back line | "`blocked · money impact ₹21,000 · bound hit: daily_discount_budget_paise`. Above ₹2,000 an offer waits for a human. Once the ₹50,000 daily discount budget is spent, the same offer is refused outright. Both bounds are code, and the demo shows whichever one actually fired." |
| 2:00 | `0:50` | step 7 · **cut to `/approvals`** | "A chargeback. Aegis assembles the evidence packet and stops. `pending_approval` — evidence is never auto-submitted. A human has to press the button." |
| 2:12 | `1:10` | steps 8–9 · **cut to `/x402`** | "Now the other direction: selling to an AI agent. HTTP 402 with a server-issued nonce, a signed payment, 200 with a settlement receipt in `X-PAYMENT-RESPONSE`. Replay the same header — `nonce_already_settled`. No second charge." |
| 2:28 | `1:20` | step 10 · **cut to `/`** | "The customer retries and pays. The demo waits for the recovery action to actually reach `executed`, then fires the capture — so the revenue is credited to the action that earned it, once, inside the window." |
| 2:38 | `1:35` | step 12, the JSON | "And the scoreboard. More was **blocked** than executed — that is the guardrails working. A third of human reviews were rejections. A third of model calls were degraded." |
| 2:46 | `1:42` | step 13 | "Because the model goes down. `AEGIS_CHAOS=llm_down` — the diagnosis falls back to deterministic rules, `degraded=true` is recorded, and the action is still bounded and still audited. The merchant keeps their recovery path." |

## Act 3 — The dashboard (2:50 – 3:35)

| Video | Shot | Say |
|---|---|---|
| 2:50 | `/` overview, model-health tile | "Every number here reconciles to source rows independently — no metric is derived from another metric. The model-health tile once read '1 call, 100% degraded' after eighteen diagnoses, because it was counting providers instead of calls." |
| 3:02 | `/ask` — type *"how much revenue did we recover this week?"* | "Ask Aegis writes SQL. The SQL goes through an AST validator, then executes as a read-only role that has no grant on a single PII column, with a five-second timeout and a 200-row limit." |
| 3:14 | `/ask` — type *"select * from information_schema.tables"* | "And this is refused before anything executes." |
| 3:22 | `/compliance`, one flag expanded | "Every flag quotes a span that exists **verbatim** in the product's own copy. If the model quotes something that is not there, the finding is downgraded — it is not shown as evidence." |

## Act 4 — What broke at 2 AM (3:35 – 4:40)

The section judges remember. Two stories, told properly. Screen: the `Bug-Feature.md` rows, or the README section.

| Video | Story | Say |
|---|---|---|
| 3:35 | **B-004** — the forged-signature hole | "The ingress passed all 27 of its own tests. Then I asked one question: who controls `event_id` at the moment of the insert? Anyone with curl — the header is read before the HMAC is checked. So: forge a request naming a real event id, get your 401. Razorpay's genuine delivery for that id then comes back `200 duplicate`, zero jobs, and a 200 tells Razorpay never to retry. **The payment was not delayed. It was gone.** The tests covered a bad signature and a good signature — never a bad one followed by a good one with the same id. Rejected deliveries now key into a namespace an attacker cannot reach." |
| 4:00 | **B-007** — the cold-start deadlock | "Two workers deadlocked on the most common event pair Razorpay sends: `order.paid` and `payment.captured` for the same order. Classic ABBA — one path locked orders then customers, the other customers then orders. I fixed the ordering. It was still wrong, and a contended burst proved it: **`SELECT FOR UPDATE` on a row that does not exist takes no lock at all.** During the window before an order first appears, the cycle came right back — and the worker hid it behind a retry. Now the order slot is *reserved* before either path can reach customers." |
| 4:22 | **B-019** — the zero | "And the one I found building this demo. Twenty-three executed recovery actions, and the recovered-revenue ledger was empty. Not the attribution logic — the clock. The simulator stamped every event a year in the past, so an action executed today could never fall inside the window of a capture dated last September. No error. The join just returned nothing, forever. A green test suite tells you the code does what you wrote. It does not tell you the system can reach the state you built it for." |

## Act 5 — Close (4:40 – 5:00)

| Video | Shot | Say |
|---|---|---|
| 4:40 | `pnpm test` scrolling to green | "322 tests. Strict TypeScript, no `any`, no `@ts-ignore`. Four migrations, each with a down. Runs on bare metal — Postgres and Node, no Docker, no hosted anything." |
| 4:50 | `/` with the footer visible | "Aegis. It reads the stream, it decides, and it stops itself when it should." |
| 4:56 | Hold on the footer | *Made with 💖 by Nabhanyu for Razorpay AI Buildathon* |

---

## If something goes wrong on the take

| Symptom | Cause | Do |
|---|---|---|
| step 10 warns `blocked: quiet_hours_local` | you are recording inside the customer's 21:00–08:00 window | re-run with `--allow-quiet-hours`, or record during the day |
| `discount_offer: blocked · daily_discount_budget_paise` | the ₹50,000 daily discount budget is spent from rehearsals | this is a correct guardrail — narrate it, or raise the budget on `/settings` before the take |
| every diagnosis says `degraded` | the model proxy is refusing (`503`) | say so on camera; it is the `C-A4` story, and the fallback is the point |
| step 11 shows no flags yet | the scan is still working through 16 products | it fills in live on `/compliance` — cut there instead |
| the prism hero is flat | no WebGPU adapter on this machine | expected; the Canvas 2D fallback is the same composition |
| every step takes 3x longer than the table above | the machine is loaded — the demo is dominated by process startup, not by the API | **close Chrome and anything else heavy before the take.** Measured on this box: `uptime` load 0.5 → one `pnpm sim` in 2.5 s and the full demo in 1:46; load 9.6 with several Chrome renderers at 50–90 % CPU → the same `pnpm sim` takes 14.5 s and the demo runs 3:51. Check with `uptime` first; the storyboard timings assume a quiet machine |
| a step dies with `simulator could not reach … fetch failed` | `pnpm dev` uses `tsx watch`, so saving any file under `apps/api/src` restarts the API mid-run | stop editing the repo during a take. The demo is right to fail closed here rather than print a table it cannot vouch for |
