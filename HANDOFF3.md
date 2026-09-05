# Handoff 3 - Task 3 complete

## Context

No `HANDOFF.md` exists in the repository. `HANDOFF2.md` was the authoritative prior handoff and identified Task 3 as the next task.

## Built

- Added permissive, passthrough Razorpay envelope and payment/order/subscription/invoice/dispute zod schemas plus the deterministic `KNOWN_EVENT_TYPES` allowlist in `packages/shared/src/razorpay/`.
- Added raw-byte HMAC-SHA256 verification using equal-length `timingSafeEqual` buffers, the scoped Fastify Buffer parser, and `rawBody` request augmentation.
- Added `POST /webhooks/razorpay` under an encapsulated `/webhooks` plugin with a 300/minute route limit. The handler verifies the raw request before trusting event fields, supports `x-razorpay-event-id` or `sha256:<body hash>`, records malformed/schema-invalid and invalid-signature deliveries, and calls an injectable post-commit hook.
- Added the transactional reconciler and repositories. The event upsert and `process_event` outbox enqueue share one `BEGIN`/`COMMIT`; duplicates increment `duplicate_count` through the unique index and never create another job. Invalid signatures are persisted as `ignored` and cannot enqueue even if their body names a known event.
- Added unit and PostgreSQL integration coverage, including 20 concurrent identical posts.

## Verification

Environment: Node `v24.20.0`, pnpm `11.25.0`, PostgreSQL 16 accepting connections on localhost.

```text
pnpm --filter @aegis/api test -- ingress
Test Files  6 passed (6)
Tests  27 passed (27)

pnpm typecheck && pnpm test && pnpm lint
packages/shared typecheck: Done; test: 3 files / 17 tests passed; lint: Done
apps/api typecheck: Done; test: 6 files / 27 tests passed; lint: Done
apps/web typecheck: Done; lint: Done; placeholder tests: Done

API_PORT=4010 pnpm --filter @aegis/api start + curl -sS -i -X POST http://localhost:4010/webhooks/razorpay -H 'content-type: application/json' -d '{}'
HTTP/1.1 401 Unauthorized
{"error":"invalid_signature"}
```

The integration assertions prove: one verified event produces one row and one `process_event` job; a sequential duplicate reports `duplicate_count=1`; 20 concurrent identical posts produce one row, `duplicate_count=19`, and one job; bad signatures produce `401`, `signature_valid=false`, ignored status, and zero jobs; unknown events are accepted but ignored with zero jobs; schema-invalid authenticated bodies return `202` and persist a reason; missing event IDs use a `sha256:` key.

## Unverified / environment notes

- Port 4000 already had an existing API process during the runtime curl probe. I did not stop that unrelated process; the same production server was verified on port 4010.
- No new dependency was added, so no Decisions entry was required.
- Task 3 does not start the worker or projections; those remain Task 4 scope.

## Paper trail

`Checklist.md` T3 steps are checked without rewording. `Flow.md` F2 is live, `Architecture.md` marks Task 3 done, `Bug-Feature.md` F-005 is implemented with evidence, and `TestChecklist.md` T3 contains the observed output.

## Next task

Task 4: job worker and precedence-guarded entity projections.
