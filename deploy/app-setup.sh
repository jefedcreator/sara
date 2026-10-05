#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Per-app setup — run once per app, idempotent.
#
#   bash deploy/app-setup.sh <app> <port> <hostname> [more hostnames...]
#
# Example:
#   bash deploy/app-setup.sh sara 3003 sara.84-12-92-46.sslip.io
#
# Creates the /srv tree, claims the port in the registry, and installs the
# nginx vhost. It does NOT deploy code — that is deploy/deploy.sh.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP=${1:?usage: app-setup.sh <app> <port> <hostname>...}
PORT=${2:?usage: app-setup.sh <app> <port> <hostname>...}
shift 2
SERVER_NAMES="$*"
[ -n "$SERVER_NAMES" ] || { echo "✗ at least one hostname is required" >&2; exit 1; }

SRV_ROOT=${SRV_ROOT:-/srv}
REGISTRY="${SRV_ROOT}/ports.env"
DEPLOY_USER=${DEPLOY_USER:-$(id -un)}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

ok()   { printf '\033[0;32m  ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[0;33m  ! %s\033[0m\n' "$*"; }
die()  { printf '\033[0;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ -f "$REGISTRY" ] || die "${REGISTRY} missing — run deploy/bootstrap-oracle.sh first"
case "$APP" in *[!a-z0-9-]*) die "app name must be lowercase alphanumeric with dashes: '${APP}'";; esac
case "$PORT" in *[!0-9]*|'') die "port must be numeric: '${PORT}'" ;; esac

# ── Port registry ───────────────────────────────────────────────────────────
# A port claimed by a different app is a configuration error, not something to
# silently overwrite: two apps on one port means one of them never starts.
CLAIMED_BY=$(awk -F= -v p="$PORT" '$1 !~ /^#/ && $2 == p {print $1}' "$REGISTRY" | head -1)
if [ -n "$CLAIMED_BY" ] && [ "$CLAIMED_BY" != "$APP" ]; then
  die "port ${PORT} is already claimed by '${CLAIMED_BY}' in ${REGISTRY}"
fi
if grep -qE "^${APP}=" "$REGISTRY"; then
  sed -i "s/^${APP}=.*/${APP}=${PORT}/" "$REGISTRY"
  ok "registry updated: ${APP}=${PORT}"
else
  echo "${APP}=${PORT}" >> "$REGISTRY"
  ok "registry claimed: ${APP}=${PORT}"
fi

# ── Directory tree ──────────────────────────────────────────────────────────
APP_DIR="${SRV_ROOT}/${APP}"
sudo install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" \
  "$APP_DIR" "${APP_DIR}/releases" "${APP_DIR}/shared" "${APP_DIR}/shared/logs"
if [ ! -f "${APP_DIR}/shared/.env" ]; then
  install -m 600 /dev/null "${APP_DIR}/shared/.env"
  warn "created an EMPTY ${APP_DIR}/shared/.env — CI writes the real one"
fi
chmod 600 "${APP_DIR}/shared/.env"
ok "${APP_DIR} ready"

# ── nginx vhost ─────────────────────────────────────────────────────────────
# nginx matches name-based vhosts by server_name, not by file order, so the
# numeric prefix is only there to sort app vhosts after the 00-* shared files.
# Deriving it from the port bought nothing and broke outside a narrow range.
SITE="/etc/nginx/conf.d/10-${APP}.conf"

if grep -qE '^[[:space:]]*ssl_certificate[[:space:]]' "$SITE" 2>/dev/null; then
  warn "${SITE} already has TLS config from certbot — leaving it untouched"
  warn "to regenerate, move it aside first (you will need to re-run certbot)"
else
  sed -e "s|__PORT__|${PORT}|g" \
      -e "s|__SERVER_NAME__|${SERVER_NAMES}|g" \
      "${HERE}/nginx/site.conf.template" | sudo tee "$SITE" >/dev/null
  sudo chmod 644 "$SITE"
  ok "wrote ${SITE} for ${SERVER_NAMES}"
fi

# ── Log rotation ────────────────────────────────────────────────────────────
sudo tee "/etc/logrotate.d/${APP}" >/dev/null <<EOF
${APP_DIR}/shared/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
    su ${DEPLOY_USER} ${DEPLOY_USER}
}
EOF
ok "log rotation configured"

sudo nginx -t
sudo systemctl reload nginx
ok "nginx reloaded — ${APP} will answer on ${SERVER_NAMES} once deployed"

