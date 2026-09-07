# Rollback — undoing changes when a module breaks

> Principle: every task is one commit and one tag, every migration has a `.down.sql`, every module has a feature flag and a compensating action, and the whole system has a kill switch. Rolling back is a decision, not an improvisation.

## 1. Levels of rollback (use the smallest that works)

| Level | When | How | Time |
|---|---|---|---|
| L0 Kill switch | money/customer actions look wrong | `UPDATE guardrail_config SET value='true' WHERE key='kill_switch'` (or Settings → Kill switch). Modules return `blocked`, x402 returns 503. Worker keeps reconciling state. | seconds |
| L1 Disable one module | one module misbehaves | `AEGIS_MODULES_DISABLED=b2b_negotiator` (comma list) and restart the API. `createModuleRegistry` drops the module at boot, so it proposes nothing and **writes no action row at all** — verify by its absence from `/api/v1/actions`, not by a `blocked` reason. Verified 2026-09-06: `disabled: 'b2b_negotiator'` → `checkout_recovery, subscription_salvager, chargeback_evidence, noop`. | 1 min |
| L2 Pause the worker | processing is corrupting projections | `AEGIS_WORKER_ENABLED=false` and restart. Ingress keeps accepting webhooks (jobs accumulate), nothing is processed. Resume later; jobs replay in order. | 1 min |
| L3 Switch the LLM to stub | provider outage or bad outputs | `AEGIS_LLM_PROVIDER=stub` and restart. Every LLM call becomes deterministic; `degraded=true` on new rows. | 1 min |
| L4 Revert a task's code | a task's commit introduced a bug | `git revert <commit>` (tasks are single commits: `git log --oneline`), or `git checkout task-NN-done` to inspect. Re-run `pnpm typecheck && pnpm test`. | 5 min |
| L5 Revert a migration | schema change broke something | `pnpm db:migrate:down` (reverts one version using `NNNN_name.down.sql`), then L4 for the code that needed it. | 5 min |
| L6 Restore the database | data corruption | `pg_restore`/`psql < backups/aegis-<ts>.sql` (take one with `pnpm db:backup` before any risky migration or demo). | 10 min |
| L7 Rebuild the environment | toolchain broken | `rm -rf node_modules apps/*/node_modules packages/*/node_modules && pnpm install --frozen-lockfile`; Node: `nvm install 24 && nvm use 24`; Postgres: re-run `scripts/bootstrap-system.sh` (idempotent). | 15 min |

## 2. Per-module compensations (`ActionModule.compensate`)

| Module | Executed effect | Compensation | Notes |
|---|---|---|---|
| checkout_recovery | `outbound_messages` row (simulated send) | mark `actions.status='compensated'`, insert `outbound_messages` row `status='suppressed', suppressed_reason='compensated'` | nothing was really sent; the trail must still show the reversal |
| subscription_salvager | scheduled `dunning_retry` jobs, `salvage_state` | cancel pending jobs by `dedupe_key`, set `salvage_state='none'`, action `compensated` | never delete history rows |
| b2b_negotiator | `negotiation_state='offer_sent'`, `current_offer_paise`, `negotiation_expiry` job, ledger `discount_granted` on acceptance | expire the offer (`state='expired'`), cancel job, insert reversing ledger entry (debit what was credited) | ledger is append-only: reverse with a new entry, never update |
| chargeback_evidence | `evidence_packets.review_status` | set back to `requires_human_review` with a review_note | submitted packets cannot be un-submitted (simulated anyway) |
| x402 | `x402_payments.status='settled'`, ledger `x402_revenue` | insert reversing ledger entry, mark payment `refunded_sim` in `payment_payload` | nonce stays consumed (replay protection must survive rollback) |

## 3. Rollback of the environment choices

| Choice | If it fails | Fallback |
|---|---|---|
| System PostgreSQL via apt (D-004) | cannot run sudo / apt broken | `pnpm add -D embedded-postgres` in `apps/api`, start it in `scripts/pg-embedded.ts` on 5432 with the same roles; SQL unchanged |
| Node 24 via nvm | nvm broken | `nvm install 22` (vitest 5 needs ≥ 22.12); `.nvmrc` → 22 |
| Prism hero (D-087) | — | The hero degrades on its own: `PrismFallback.tsx` is server-rendered and always behind the canvas, so a machine with no `navigator.gpu`, a failed shader compile or a device lost mid-session all end at the same still of the same scene, with no reload and nothing to switch. To take the GPU path out of the product entirely, replace the `<canvas>` in `PrismStage.tsx` with nothing and drop the `useEffect`; `PrismHero`, `PrismFallback` and the legend keep working untouched |
| OpenAI proxy / Anthropic | key invalid, proxy down | `AEGIS_LLM_PROVIDER=stub` (L3) |
| Next.js 16 features | build issue | pin `next@16.x` exact in `apps/web/package.json`; never upgrade mid-task |
| Sandbox / BYOK (T25) | a tenant secret or caller key misbehaves | `DELETE FROM guardrail_config WHERE key LIKE 'sandbox\_secret\_%'` returns every account to the `.env` secret (audited rows stay); L3 (`AEGIS_LLM_PROVIDER=stub`) also disables browser keys because the operator's pin outranks them; `pnpm db:migrate:down` reverts 0005 (RLS) without touching data |

## 4. Checklist before a risky change
1. `pnpm db:backup` (writes `backups/aegis-<timestamp>.sql`, gitignored).
2. `git tag task-NN-pre` on the current commit.
3. Make the change in one commit.
4. Run the task's `TestChecklist.md` section.
5. If red and not fixable in 30 minutes: L4/L5, record in `Bug-Feature.md` (Bugs + 2 AM log).
