#!/usr/bin/env bash
# Aegis — PostgreSQL roles and databases (idempotent). Called by bootstrap-system.sh; safe to re-run alone with sudo.
# Intent: one read-write application role, one read-only role for AI-generated SQL, two databases (app + test).
# Passwords default to the values in .env.example; override with AEGIS_DB_PASSWORD / AEGIS_RO_PASSWORD.
set -euo pipefail

AEGIS_DB_PASSWORD="${AEGIS_DB_PASSWORD:-aegis_dev_password}"
AEGIS_RO_PASSWORD="${AEGIS_RO_PASSWORD:-aegis_readonly_password}"

run_psql() { sudo -u postgres psql -v ON_ERROR_STOP=1 -X -q "$@"; }

# Roles: created if missing, password/settings (re)applied every run.
run_psql <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aegis') THEN
    CREATE ROLE aegis LOGIN PASSWORD '${AEGIS_DB_PASSWORD}';
  ELSE
    ALTER ROLE aegis WITH LOGIN PASSWORD '${AEGIS_DB_PASSWORD}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aegis_readonly') THEN
    CREATE ROLE aegis_readonly LOGIN PASSWORD '${AEGIS_RO_PASSWORD}';
  ELSE
    ALTER ROLE aegis_readonly WITH LOGIN PASSWORD '${AEGIS_RO_PASSWORD}';
  END IF;
END
\$\$;
-- Intent: the read-only role can never write and can never run long queries, even if the app-level validator has a bug.
ALTER ROLE aegis_readonly SET default_transaction_read_only = on;
ALTER ROLE aegis_readonly SET statement_timeout = '5s';
ALTER ROLE aegis_readonly SET idle_in_transaction_session_timeout = '10s';
SQL

# Databases: CREATE DATABASE cannot run inside a transaction/DO block, so check first.
for db in aegis aegis_test; do
  if [[ "$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '${db}'")" != "1" ]]; then
    run_psql -c "CREATE DATABASE ${db} OWNER aegis;"
  fi
  run_psql -c "GRANT CONNECT ON DATABASE ${db} TO aegis_readonly;"
  # Intent: PG15+ makes schema public non-writable for non-owners; the app role owns the DB and needs the schema.
  run_psql -d "${db}" -c "ALTER SCHEMA public OWNER TO aegis;"
done

echo "roles aegis / aegis_readonly and databases aegis / aegis_test are ready"
