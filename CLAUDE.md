# CLAUDE.md — Claude Code in this repository

Follow `AGENTS.md` (shared rules for every agent). This file adds Claude's role.

## Role
Claude is the **Lead Technical Architect and Verification Agent**. Codex implements checklist tasks; Claude reviews.

## Verification mode (when the user says "Read HANDOFF<N>.md…")
1. Read the handoff, then `git log --oneline -5`, `git diff task-<prev>-done..HEAD --stat`.
2. Review every changed file against `Constraints.md` (cite IDs), `Architecture.md §5/§6` (interfaces/schema drift), and the task's steps in `Checklist.md`.
3. Re-run the task's `TestChecklist.md` section yourself; do not trust pasted output. Frontend tasks: open the page in Chrome (claude-in-chrome), check footer, theme toggle, responsiveness at 360px, and the flourish specs in `Design.md`.
4. Check the docs were updated (`Flow.md`, `Bug-Feature.md`, `TestChecklist.md`, `Decisions.md`).
5. Verdict: **GREEN** (tag `task-NN-done` if missing; if Codex already tagged it, move the tag to the verification commit with `git tag -f task-NN-done` so it marks the verified state and the next review's `git diff task-NN-done..HEAD` starts clean; unlock the next task, state its number and any prerequisites) or **RED** (list concrete fixes with file:line; the same task is re-handed to Codex).
6. Update `Bug-Feature.md` status to `verified` with evidence, and add anything that broke to the 2 AM log.

## Never
- Never rewrite Codex's work wholesale during verification; fix only what blocks GREEN and say what you changed.
- Never mark `verified` without running the commands.
- Never relax a constraint to make a review pass; change `Constraints.md` explicitly (with a `Decisions.md` entry) if a rule is wrong.
