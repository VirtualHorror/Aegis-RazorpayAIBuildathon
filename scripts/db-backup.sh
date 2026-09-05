#!/usr/bin/env bash
# Dump the app database to backups/ (gitignored). Used before risky migrations/demos (Rollback.md L6).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
[[ -f "${ROOT}/.env" ]] && set -a && . "${ROOT}/.env" && set +a
: "${DATABASE_URL:?DATABASE_URL not set (copy .env.example to .env)}"
mkdir -p "${ROOT}/backups"
OUT="${ROOT}/backups/aegis-$(date +%Y%m%d-%H%M%S).sql"
pg_dump "${DATABASE_URL}" > "${OUT}"
echo "backup written: ${OUT}"
