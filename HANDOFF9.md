# Handoff 9 - Task 6: provider-agnostic LLM client

**Generated**: 2026-09-05 10:01 UTC
**Branch**: `main`
**Baseline**: `task-05-done` (`753c624`)
**Status**: Task 6 implemented and verified locally; ready for the single task commit/tag

## Built

- Added the strict `LlmClient`/`LlmJsonRequest`/`LlmJsonResult` boundary and `LlmUnavailableError` in `apps/api/src/llm/client.ts`.
- Added official Anthropic and OpenAI SDK adapters. Both return only zod-validated JSON; OpenAI handles proxy `response_format` rejection and makes exactly one schema-repair attempt.
- Added deterministic, schema-validating stub fixtures keyed to the simulator's payment failure features, plus prompt definitions, SHA-256 input digests, and recursive PII masking.
- Added the resilient wrapper: `AbortSignal.timeout`, one transient retry, an injectable-clock three-failure/60-second breaker, structured per-call info logging, and development-only `x-aegis-chaos: llm_down` request context via `AsyncLocalStorage`.
- Added provider factory resolution (`auto|anthropic|openai|stub`), boot-time selection logging, `llm.describe()`, `GET /api/v1/system`, and the `llm:smoke` script.
- Added config/env entries, SDK dependency decision D-044, and coverage for `apps/api/scripts` in strict TypeScript and lint.
- Updated `Checklist.md`, `Flow.md`, `Architecture.md`, `Bug-Feature.md` (F-008), `TestChecklist.md` (T6), and `Decisions.md`.

## Verification

Database status:

```text
$ pnpm --filter @aegis/api run db:status
$ tsx src/db/migrate-cli.ts status
applied: 0001_init, 0002_readonly_grants, 0003_projection_guards
pending: (none)
```

Focused LLM tests:

```text
$ AEGIS_LLM_PROVIDER=stub pnpm --filter @aegis/api test -- llm
$ vitest run -- llm
Test Files  17 passed (17)
     Tests  85 passed (85)
```

Deterministic smoke test:

```text
$ AEGIS_LLM_PROVIDER=stub pnpm --filter @aegis/api llm:smoke
$ tsx scripts/llm-smoke.ts
provider=stub model=fixture-v1
{"root_cause":"THREE_DS_AUTH_FAILED","confidence":0.9,"intervention_strategy":"RETRY_LINK_LOCALIZED","rationale":"The payment authentication step failed before capture completed.","customer_facing_hint":"Retry securely with your bank authentication step."}
```

Strict TypeScript coverage proof:

```text
$ pnpm --filter @aegis/api exec tsc --noEmit --listFiles | grep 'apps/api/scripts/llm-smoke.ts'
/home/nabhanyu/Downloads/RazorpayAIBuildathon/apps/api/scripts/llm-smoke.ts
```

Fail-closed simulator proof used an explicit unreachable database URL, not `env -u DATABASE_URL` (the simulator reloads `.env`). The API was temporarily run on port 4077 with its normal database, and the simulator inspector alone received the override:

```text
$ DATABASE_URL='postgres://nobody:nobody@127.0.0.1:5999/nowhere' pnpm --filter @aegis/api sim unknown_event --seed t6-nodb-check-final-20260905 --api http://127.0.0.1:4077
seed=t6-nodb-check-final-20260905
api=http://127.0.0.1:4077/webhooks/razorpay
warning: database classification lookup failed: connect ECONNREFUSED 127.0.0.1:5999
simulator error: could not verify unknown_event evt_0002_5ed5a3fc in webhook_events; DATABASE_URL is required for ignored classification
Exit status 1
```

The temporary API was stopped with `kill -TERM 170859`; port 4077 was confirmed closed. `git diff --check` passed.

Final gate:

```text
$ pnpm typecheck && pnpm test && pnpm lint
typecheck: packages/shared, apps/api, apps/web all Done
tests: packages/shared 5 files / 47 tests passed; apps/api 17 files / 85 tests passed; web placeholder passed
lint: packages/shared, apps/api, apps/web all Done
```

## Limitations and known issue

- `ANTHROPIC_API_KEY` is absent on this machine. Anthropic behavior is SDK-mock-tested only; no live Anthropic output is claimed.
- An OpenAI-compatible proxy key is present, but its live chat request did not complete within the configured timeout. OpenAI behavior is covered by mocked tests; no live OpenAI output is claimed.
- Rate-limit-sensitive burst probes were not used as Task 6 evidence. The ingress limiter allows 300 requests per minute; back-to-back bursts can return 429 and must wait for the window to clear.
- B-007 remains open from Task 5: a contended `payment.*` plus `order.*` cold-start projection can deadlock and then succeed on retry (`attempts=2`). It does not touch `apps/api/src/llm/`, but must be fixed before Task 8's orchestrator and later action modules extend the global lock order.

## Commit and next task

Commit exactly once as:

```text
feat(t06): provider-agnostic LLM client with resilience and stub
```

Then tag `task-06-done`. Do not stage stale input handoffs `HANDOFF6.md` or `HANDOFF8.md`.

Next task: Task 7, Diagnostician (deterministic hints -> LLM -> cross-check -> fallback). Do not begin it in this handoff.
