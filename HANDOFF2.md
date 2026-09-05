# Handoff 2 — Task 2 complete

## Initial context

The requested `HANDOFF.md` and numbered handoff files were not present in the repository. The Task 2 section of `Checklist.md`, together with `Constraints.md`, `Architecture.md`, `Flow.md`, and `TestChecklist.md`, was used as the authoritative scope.

## Built

- Added the 20-table core PostgreSQL schema in `db/migrations/0001_init.sql`, with intent/flow comments, indexes, status checks, integer-paise money columns, and a reverse dependency down migration.
- Added `0002_readonly_grants.sql` and its down migration. The `aegis_readonly` role receives table grants everywhere except PII-bearing `customers` and `payments`; those tables receive explicit column grants that omit email/contact/name/issuer. Missing roles raise a PostgreSQL warning and do not fail the migration.
- Added deterministic, idempotent demo fixtures for 12 customers, 16 products (five risky descriptions and six agent-purchasable products), 12 guardrails, three invoices, four active subscriptions, and six orders.
- Added `loadGuardrailConfig()` with fail-fast missing-key detection and zod validation, plus the typed `GuardrailConfig` contract.
- Added the API `db:seed` command and made the documented `pnpm db:migrate -- --status` shorthand resolve to migration status.
- Added `aegis_test` schema integration coverage for all tables, full down/up migration round trips, readonly PII denial, and typed guardrail loading.

## Verification

Environment: Node `v24.20.0`, pnpm `11.25.0`, PostgreSQL 16 accepting connections on localhost.

```text
pnpm db:migrate
applied 0001_init
applied 0002_readonly_grants
applied 2 migration(s)

pnpm db:migrate -- --status
applied: 0001_init, 0002_readonly_grants
pending: (none)

pnpm db:seed
seeded: customers=12, products=16, guardrails=12, invoices=3, subscriptions=4, orders=6

pnpm db:seed  (rerun)
seeded: customers=12, products=16, guardrails=12, invoices=3, subscriptions=4, orders=6

psql "$DATABASE_URL" -c "\dt"
21 relations: schema_migrations plus the 20 Architecture.md section 6 tables

psql "$DATABASE_URL_READONLY" -c "select email from customers limit 1"
ERROR: permission denied for table customers

pnpm --filter @aegis/api test -- migrate
Test Files  4 passed (4)
Tests  14 passed (14)
```

The integration suite ran against `DATABASE_URL_TEST` and additionally verified the complete down/up round trip and guardrail snapshot. A checksum refusal was intentionally observed after a migration comment was changed post-apply; the local `aegis` and `aegis_test` databases were rolled back through their down migrations and reapplied using the final file checksums. No checksum bypass was used.

The final repository-wide commands were run before handoff:

```text
pnpm typecheck
packages/shared typecheck: Done
apps/api typecheck: Done
apps/web typecheck: Done

pnpm test
packages/shared: Test Files 2 passed (2), Tests 14 passed (14)
apps/api: Test Files 4 passed (4), Tests 14 passed (14)
apps/web: no tests yet (Task 17 scope)

pnpm lint
packages/shared lint: Done
apps/api lint: Done
apps/web lint: Done
```

## Deviations and unverified items

- No `HANDOFF.md` existed, as noted above; no implementation scope was expanded beyond Task 2.
- The optional missing-role branch was implemented and is covered by SQL control flow, but this machine has the `aegis_readonly` role, so the warning branch was not exercised against a role-less database.
- No new dependency was added. `scripts/db-backup.sh` already provided the required `db:backup` root script.

## Next task

Task 3: idempotent Razorpay webhook ingress (signature verification, dedupe, and transactional outbox).
