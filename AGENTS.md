# AGENTS.md — rules for any coding agent working in this repository

This file is read automatically by OpenAI Codex and by Claude Code (via `CLAUDE.md`). Humans should read it too.

## What this project is
Aegis — The Agentic Merchant OS for Razorpay. An event-driven AI control plane: idempotent webhook reconciliation → AI diagnosis → guard-railed action modules → human approvals → observability. Submission for the Razorpay AI Intern Buildathon 2026 by Nabhanyu.

## Reading order (do this before touching code)
1. `HANDOFF.md` (or the `HANDOFF<N>.md` you were pointed to) — your task and the current state.
2. `Constraints.md` — the never-do list. Violations fail review.
3. `Checklist.md` — find your task; only that task is in scope.
4. `Architecture.md` §5 (interfaces) and §6 (schema); `Flow.md` for the flow you touch; `Design.md` for frontend tasks.
5. `Decisions.md` — do not re-litigate accepted decisions; add a new entry if you must deviate.

## Working rules
- **One task per handoff.** Finish it completely (code + tests + docs + commit). Do not begin the next one.
- **Deterministic code for routing, state, and money. LLM only for language.** If you are about to let a model output decide a number or a branch, stop and re-read `Constraints.md §A`.
- **Comment intent and flow** on every non-obvious block: `// Intent: why this exists` and `// Flow: what happens in order`. State machines get their transition table in a comment. Guard rules say which bound they enforce.
- **No shortcuts that look like progress**: no hardcoded data where a DB query belongs, no `any`, no swallowed errors, no skipped idempotency checks, no "TODO later".
- **Tests are part of the task.** Pure logic → unit tests; DB/HTTP paths → integration tests against `DATABASE_URL_TEST`. Run `pnpm typecheck && pnpm test && pnpm lint` before you say done.
- **Verify with real commands.** The task's section in `TestChecklist.md` lists them. Paste actual output into your handoff. If something cannot be verified on this machine (e.g. no API key), say so explicitly.
- **Update the docs in the same task**: `Flow.md` (flip `[planned Tn]` → `[live]`, fix names to match the code), `Bug-Feature.md` (status + evidence, bugs you found, deviations), `TestChecklist.md` (make the pending section real), `Decisions.md` (new deps/choices).
- **Checklist hygiene.** Tick `- [ ]` → `- [x]`; never reword a step to describe what you built instead. If you had to deviate from a step, leave its text alone and record the deviation in `Bug-Feature.md` ("Deviations") and the handoff.
- **Every TypeScript file is typechecked and linted.** Code outside `apps/*` and `packages/*` (`db/seed`, `scripts/`) must be included by a package's `typecheck` and `lint` scripts (`db/seed` is covered by `@aegis/api`, see D-030). A file that no tsconfig includes is not typechecked, however green `pnpm typecheck` looks.
- **Commit once at the end**: `feat(tNN): <summary>` (or `fix`/`docs`/`chore`), then `git tag task-NN-done`. Never commit `.env`, `node_modules`, `.next`, `backups/`.
- **Stay inside the repo.** Do not install system packages (no `sudo`), do not change global git config, do not touch files outside this directory except `~/.nvm` usage.

## Environment quick facts
- Node 24 via nvm: `source ~/.nvm/nvm.sh && nvm use` (reads `.nvmrc`). pnpm 11.
- PostgreSQL 16 on localhost:5432 — set up once by the human with `sudo bash scripts/bootstrap-system.sh`. Connection strings in `.env.example`. If `pg_isready` fails, say so in the handoff; do not work around it with SQLite or in-memory state.
- LLM keys: `OPENAI_API_KEY` + `OPENAI_API_BASE` exist in the shell environment; `ANTHROPIC_API_KEY` does not. `AEGIS_LLM_PROVIDER=stub` always works.
- API: `pnpm --filter @aegis/api dev` (port 4000). Web: `pnpm --filter @aegis/web dev` (port 3000). Both: `pnpm dev`.

## Handing back
Write `HANDOFF<N+1>.md` (the human runs `/handoff:create`, but make sure these facts are easy to find): what you built, exact commands you ran with output, anything you could not verify, deviations, and the next task number. The Verification Agent will review the diff against `Constraints.md` and this file.
