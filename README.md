# Aegis — The Agentic Merchant OS for Razorpay

> Razorpay AI Intern Buildathon 2026 · Open Track (spanning Revenue Recovery, Growth & Agentic Commerce, Risk, Finance Controller) · by Nabhanyu

Aegis sits on top of a merchant's Razorpay account, reconciles the webhook stream **idempotently** into a local PostgreSQL state store, diagnoses failures with an LLM that is only ever allowed to pick from bounded enums, and routes problems to guard-railed action modules (checkout recovery, subscription salvage, B2B negotiation, chargeback evidence) with a human approval gate, a full audit trail, an x402 gateway for AI buyers, and a natural-language dashboard.

**Status:** Task 1 (environment + scaffold) complete. Implementation follows `Checklist.md` task by task; this README is rewritten in Task 23.

## Quickstart (Ubuntu 24.04)

```bash
# 1. one-time, needs sudo: OS packages + PostgreSQL 16 + roles/databases
sudo bash scripts/bootstrap-system.sh

# 2. user-level: Node 24 via nvm, pnpm, .env, dependencies, migrations, seed
bash scripts/setup.sh

# 3. run everything
pnpm dev            # API → http://localhost:4000/health · Dashboard → http://localhost:3000
```

Without PostgreSQL the API still starts and reports `{"status":"degraded","db":"unavailable"}` on `/health`.

## Repository map

| Path | What |
|---|---|
| `apps/api` | Fastify API + worker: ingress, orchestrator, modules, x402, NL query, compliance |
| `apps/web` | Next.js 16 dashboard |
| `packages/shared` | domain enums, precedence rules, money helpers, Razorpay schemas |
| `db/` | SQL migrations + seed |
| `scripts/` | bootstrap, setup, simulator, demo |
| `Architecture.md` `Flow.md` `Decisions.md` `Constraints.md` `Design.md` | the design |
| `Checklist.md` `TestChecklist.md` `Bug-Feature.md` `Rollback.md` | the process |
| `AGENTS.md` `CLAUDE.md` | rules for the coding agents that build this |

## Documentation set

The project is built by a multi-agent workflow (Claude as architect + verifier, Codex as developer). Every decision, flow, constraint, test command and rollback path is written down before the code exists — read `Architecture.md` first.

---
Made with 💖 by Nabhanyu for Razorpay AI Buildathon
