#!/usr/bin/env bash
# Mirrors this dev checkout into the hosted production checkout (Decisions.md D-081, D-088).
#
# Intent: the production tree owns its own runtime state — `.env` (its own secrets and public hostnames), the PM2
#         logs, its `node_modules`, its build and its database backups. A mirror that copies those makes the dev
#         machine's configuration the production configuration, silently; that is B-029, and the exclude list below
#         is the fix. `--delete` is what keeps files deleted in git from lingering in production, so it stays.
# Flow:   rsync (mirror, minus the prod-owned paths) → deploy/sync-web-env.sh in the destination (rewrites
#         apps/web/.env.production from the *prod* .env) → you run the build and `pm2 restart ecosystem.config.js`.
#
# Usage:  bash deploy/sync-prod.sh [--dry-run] [/path/to/prod/checkout]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DRY=()
if [[ "${1:-}" == "--dry-run" ]]; then DRY=(--dry-run); shift; fi
PROD="${1:-$(dirname "$ROOT")/AegisProd-RazorpayAIBuildathon}"

[[ -d "$PROD" ]] || { echo "no such production checkout: $PROD"; exit 2; }
PROD="$(cd "$PROD" && pwd)"
[[ "$PROD" != "$ROOT" ]] || { echo "refusing to sync $ROOT onto itself"; exit 2; }
# A wrong destination plus --delete empties a directory. Demand proof this is an Aegis checkout before deleting in it.
[[ -f "$PROD/ecosystem.config.js" ]] || { echo "$PROD has no ecosystem.config.js — not an Aegis production checkout"; exit 2; }
[[ -f "$PROD/.env" ]] || { echo "$PROD has no .env — create it from .env.example first (deploy/README.md step 2)"; exit 2; }

# Prod-owned, never mirrored from dev:
#   .env                      its hostnames (WEB_ORIGIN, NEXT_PUBLIC_API_URL), API_HOST, TRUST_PROXY and its own
#                             RAZORPAY_WEBHOOK_SECRET / X402_SIM_SECRET — D-081 requires these to differ from dev's
#   .env.bak-*                the timestamped backups this file's own edits leave behind
#   apps/web/.env.production  derived from the prod .env by sync-web-env.sh, below
#   logs                      PM2 writes here; ecosystem.config.js names these paths and the directory must exist
#   backups                   the production database dumps (scripts/db-backup.sh)
#   node_modules/.git/.next   per-tree by definition; .next must be rebuilt, never copied
rsync -av "${DRY[@]}" --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '.next' \
  --exclude 'logs' \
  --exclude 'backups' \
  --exclude '.env' \
  --exclude '.env.bak-*' \
  --exclude 'apps/web/.env.production' \
  "$ROOT/" "$PROD/"

if [[ ${#DRY[@]} -gt 0 ]]; then
  echo
  echo "dry run only — nothing was written to $PROD"
  exit 0
fi

# Next.js reads env files from apps/web only, so this must run from the *destination* to pick up the prod .env.
bash "$PROD/deploy/sync-web-env.sh"

cat <<NEXT

synced $ROOT -> $PROD
next:  cd "$PROD" && pnpm install && pnpm --filter @aegis/web build && pm2 restart ecosystem.config.js
NEXT
