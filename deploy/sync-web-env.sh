#!/usr/bin/env bash
# Next.js reads env files from apps/web only, never from the repo root (Decisions.md D-081).
# Flow: copy the NEXT_PUBLIC_* lines of the root .env into apps/web/.env.production so `next build` inlines them into
#       the client bundle and `next start` reads them for server components. Run before every production build.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f "$ROOT/.env" ]] || { echo "no $ROOT/.env — copy .env.example first"; exit 2; }
grep -E '^NEXT_PUBLIC_[A-Z0-9_]+=' "$ROOT/.env" > "$ROOT/apps/web/.env.production"
echo "wrote apps/web/.env.production:"
cat "$ROOT/apps/web/.env.production"
