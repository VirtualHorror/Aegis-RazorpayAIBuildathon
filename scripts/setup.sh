#!/usr/bin/env bash
# Aegis — user-level setup (no sudo). Run after scripts/bootstrap-system.sh.
# Flow: check toolchain → .env → pnpm install → migrate → seed (when those scripts exist) → print next steps.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

echo "==> toolchain"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "${NVM_DIR}/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  . "${NVM_DIR}/nvm.sh"
  nvm install >/dev/null 2>&1 || true   # honours .nvmrc
  nvm use >/dev/null
fi
command -v node >/dev/null || { echo "node missing: install nvm (https://github.com/nvm-sh/nvm) then re-run"; exit 1; }
command -v pnpm >/dev/null || npm install -g pnpm@11
echo "node $(node -v) · pnpm $(pnpm -v)"

echo "==> postgres"
if command -v pg_isready >/dev/null && pg_isready -h localhost -p 5432 -q; then
  echo "postgres: accepting connections"
else
  echo "postgres: NOT reachable on localhost:5432 — run: sudo bash scripts/bootstrap-system.sh" >&2
  PG_MISSING=1
fi

echo "==> .env"
if [[ ! -f .env ]]; then cp .env.example .env; echo "created .env from .env.example"; else echo ".env exists"; fi

echo "==> dependencies"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

if [[ -z "${PG_MISSING:-}" ]]; then
  echo "==> database"
  pnpm db:migrate
  if pnpm --filter @aegis/api run --silent db:seed >/dev/null 2>&1; then echo "seeded"; else echo "(seed script not available yet)"; fi
fi

echo
echo "Next: pnpm dev   →  API http://localhost:4000/health · Web http://localhost:3000"
