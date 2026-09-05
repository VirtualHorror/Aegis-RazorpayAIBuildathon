# Bug / Feature tracker — scope → build → verification

> Every feature and bug has a row. Status: `scoped` → `in_progress` → `implemented` → `verified` (only the Verification Agent sets `verified`, citing evidence).
> Evidence = the command run + observed output, or a screenshot path. "It works" is not evidence.
> The file name is `Bug-Feature.md` because `/` cannot appear in a file name (D-021).

## Features

| ID | Feature | Task | Owner | Status | Verification evidence |
|---|---|---|---|---|---|
| F-001 | Bare-metal environment (Node 24, pnpm 11, PostgreSQL 16 bootstrap script) | T1 | Claude | verified (Postgres part pending) | `node -v` → v24.20.0, `pnpm -v` → 11.25.0; `scripts/bootstrap-system.sh` passes `bash -n`; PostgreSQL install awaits the human `sudo` step (DV-001) |
| F-002 | Monorepo scaffold (api, web, shared), typecheck + tests green | T1 | Claude | verified | `pnpm typecheck` / `test` (23 tests) / `lint` / `next build` all green; `/health` degraded-but-up without Postgres — see `TestChecklist.md` §T1 |
| F-003 | Footer + theme toggle in the web shell | T1 | Claude | verified | `curl localhost:3000` contains the footer text, `suppressHydrationWarning`, the theme radiogroup and `₹4,20,000.00` from `@aegis/shared` |
| F-004 | Migration runner + core schema + seed | T2 | Codex | scoped | |
| F-005 | Idempotent webhook ingress (HMAC, dedupe, outbox) | T3 | Codex | scoped | |
| F-006 | Job worker (SKIP LOCKED, backoff, DLQ, sweeper) + entity projections with precedence | T4 | Codex | scoped | |
| F-007 | Webhook simulator CLI (scenarios, duplicates, bursts, chaos) | T5 | Codex | scoped | |
| F-008 | LLM client abstraction (anthropic/openai/stub + resilient wrapper + prompt registry) | T6 | Codex | scoped | |
| F-009 | Diagnostician (hints → LLM → cross-check → fallback) | T7 | Codex | scoped | |
| F-010 | EventOrchestrator + ActionModule interface + actions audit + SSE bus | T8 | Codex | scoped | |
| F-011 | CheckoutRecovery module (localised WhatsApp retry link) | T9 | Codex | scoped | |
| F-012 | SubscriptionSalvager module (dunning state machine) | T10 | Codex | scoped | |
| F-013 | B2BNegotiator module (bounded negotiation) | T11 | Codex | scoped | |
| F-014 | ChargebackEvidence module (packet + human review) | T12 | Codex | scoped | |
| F-015 | Approvals API + ledger + recovery attribution + metrics | T13 | Codex | scoped | |
| F-016 | x402 gateway (challenge, verify, settle, replay guard, caps) | T14 | Codex | scoped | |
| F-017 | Ask Aegis: Text-to-SQL sandbox + deterministic forecaster | T15 | Codex | scoped | |
| F-018 | Compliance scanner (keywords + LLM rubric + evidence check) | T16 | Codex | scoped | |
| F-019 | Web shell: design system, nav, theme, footer, SSE hook, GlowInput | T17 | Codex | scoped | |
| F-020 | Overview + Events pages | T18 | Codex | scoped | |
| F-021 | Actions + Approvals pages | T19 | Codex | scoped | |
| F-022 | Ask Aegis + Compliance pages | T20 | Codex | scoped | |
| F-023 | x402 Lab + Settings pages | T21 | Codex | scoped | |
| F-024 | Flourishes: PrismHero (vgpu + 2D fallback), HalftoneField, polish, a11y | T22 | Codex | scoped | |
| F-025 | Demo storyboard script, README, video plan | T23 | Codex | scoped | |
| F-026 | Hardening: security review, failure drills, final test pass | T24 | Codex | scoped | |

## Bugs

| ID | Title | Found in | Root cause | Fix | Status | Evidence |
|---|---|---|---|---|---|---|
| B-001 | API printed `usage: migrate-cli <up\|down\|status>` and exited with code 2 at boot | T1 | `server.ts` imported `MIGRATIONS_DIR` from `db/migrate-cli.ts`, whose top-level `main()` ran on import | moved paths to `apps/api/src/db/paths.ts`; the CLI now runs only when `process.argv[1]` is the CLI file (`migrate-cli.ts:57`) | verified | `tsx src/server.ts` → `aegis api listening on http://0.0.0.0:4000`; `tsx src/db/migrate-cli.ts` → usage, exit 2 |

Template for a new bug:
```
| B-0NN | <symptom in one line> | <task/commit> | <what actually caused it> | <what changed, file:line> | open/fixed/verified | <command + output> |
```

## Deviations from the checklist

| ID | Task | What deviated | Why | Approved by |
|---|---|---|---|---|
| DV-001 | T1 | PostgreSQL install/role creation could not be executed by the agent | `sudo` requires a password on this VM (D-028); the script `scripts/bootstrap-system.sh` is ready and must be run by the human once | Architect (self), pending human run |

## The 2 AM log (failure recovery stories for the submission)

> Evaluators read "what broke at 2 AM, and how you got out". Record real incidents here as they happen: what broke, how it was noticed, how it was diagnosed, what fixed it, what changed so it cannot recur. Keep it honest.

| # | When | What broke | How we noticed | Diagnosis | Fix | Prevention |
|---|---|---|---|---|---|---|
| 1 | 2026-09-05 | Nothing runs on the box: no Node, no Postgres, and `sudo` wants a password so the agent cannot apt-install | first `which` sweep | environment, not code | user-level `nvm` for Node; privileged steps isolated into a single script for the human | `scripts/setup.sh` checks prerequisites and prints exactly what is missing |
| 2 | 2026-09-05 | First API boot printed the migration CLI's usage text and exited | `curl /health` returned nothing; the log showed `usage: migrate-cli` | a module with side effects at import time was imported for one constant | split constants into `db/paths.ts`; guard the CLI entry point (B-001) | rule for Codex: entry-point modules export nothing; shared constants live in side-effect-free modules |
| 3 | 2026-09-05 | `pkill -f 'tsx src/server.ts'` killed the verification shell itself (pattern matched the shell's own command line) | tool exit code 144, no output | `pkill -f` matches every process whose argv contains the pattern, including the parent shell | keep the child PID (`$!`) and `kill -TERM $PID` | `TestChecklist.md` uses PID-based shutdown everywhere |
