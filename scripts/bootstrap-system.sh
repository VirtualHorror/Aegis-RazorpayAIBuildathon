#!/usr/bin/env bash
# Aegis — system bootstrap (the ONLY step that needs sudo).
# Intent: install OS-level dependencies on a clean Ubuntu 24.04 host and create the PostgreSQL roles/databases.
# Flow: apt packages → enable postgresql → bootstrap-db.sh (idempotent SQL) → print connection check.
# Usage: sudo bash scripts/bootstrap-system.sh        (re-runnable; every step is idempotent)
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "This script needs root for apt/systemctl. Run: sudo bash scripts/bootstrap-system.sh" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DEBIAN_FRONTEND=noninteractive

echo "==> [1/4] apt packages"
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg git jq build-essential \
  postgresql-16 postgresql-contrib postgresql-client-16

echo "==> [2/4] postgresql service"
systemctl enable --now postgresql
# Wait for the socket (fresh installs can take a second to accept connections).
for _ in $(seq 1 30); do
  if sudo -u postgres pg_isready -q; then break; fi
  sleep 1
done
sudo -u postgres pg_isready

echo "==> [3/4] roles and databases (idempotent)"
bash "${SCRIPT_DIR}/bootstrap-db.sh"

echo "==> [4/4] verification"
sudo -u postgres psql -tAc "select 'postgres ' || version();"
sudo -u postgres psql -tAc "select 'roles: ' || string_agg(rolname, ', ') from pg_roles where rolname in ('aegis','aegis_readonly');"
sudo -u postgres psql -tAc "select 'databases: ' || string_agg(datname, ', ') from pg_database where datname in ('aegis','aegis_test');"
echo
echo "Done. Next (as your normal user): bash scripts/setup.sh"
