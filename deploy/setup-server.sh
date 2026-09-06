#!/usr/bin/env bash
# One-shot privileged setup for the hosted Aegis instance (Decisions.md D-081). Run once, as root, from the
# production checkout, after `pm2 start ecosystem.config.js && pm2 save` has been run as the deploy user:
#   sudo bash deploy/setup-server.sh
# Flow: apt (nginx + certbot) → install the site → nginx -t + reload → certbot adds TLS and the HTTP→HTTPS redirect
#       → systemd unit so PM2 resurrects the saved processes on boot → curl both hostnames over TLS.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_USER="${SUDO_USER:-nabhanyu}"
DEPLOY_HOME="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
WEB_HOST="aegis.nabhanyubm.tech"
API_HOST="api.aegis.nabhanyubm.tech"

[[ $EUID -eq 0 ]] || { echo "run with sudo"; exit 2; }

echo "==> packages (nginx, certbot)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx certbot python3-certbot-nginx

echo "==> nginx site: $ROOT/deploy/nginx/aegis.conf"
install -m 0644 "$ROOT/deploy/nginx/aegis.conf" /etc/nginx/sites-available/aegis
ln -sfn /etc/nginx/sites-available/aegis /etc/nginx/sites-enabled/aegis
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

echo "==> certbot (HTTP-01 on port 80: the security group must allow 80 and 443 from anywhere)"
certbot --nginx -d "$WEB_HOST" -d "$API_HOST" --non-interactive --agree-tos --register-unsafely-without-email
nginx -t
systemctl reload nginx

echo "==> pm2 startup unit for $DEPLOY_USER"
NODE_BIN="$(ls -d "$DEPLOY_HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1 || true)"
if [[ -n "$NODE_BIN" && -x "$NODE_BIN/pm2" ]]; then
  env PATH="$PATH:$NODE_BIN" "$NODE_BIN/pm2" startup systemd -u "$DEPLOY_USER" --hp "$DEPLOY_HOME"
  systemctl is-enabled "pm2-$DEPLOY_USER" || true
else
  echo "pm2 not found under $DEPLOY_HOME/.nvm — run 'npm i -g pm2 && pm2 start ecosystem.config.js && pm2 save' as $DEPLOY_USER, then re-run this script"
fi

echo "==> verify"
curl -sS -o /dev/null -w "https://$WEB_HOST/ -> HTTP %{http_code}\n" "https://$WEB_HOST/"
curl -sS -w "\nhttps://$API_HOST/health -> HTTP %{http_code}\n" "https://$API_HOST/health"
curl -sS -o /dev/null -w "http://$WEB_HOST/ -> HTTP %{http_code} (redirect expected)\n" "http://$WEB_HOST/"
echo "done"
