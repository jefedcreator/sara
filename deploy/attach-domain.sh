#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Point an app at a real domain and issue a certificate for it.
#
#   bash deploy/attach-domain.sh <app> <domain> [alias...]
#
# Example:
#   bash deploy/attach-domain.sh sara sara.example.com www.sara.example.com
#
# Prerequisite: every name must already resolve to this host. Let's Encrypt
# validates by fetching over HTTP at whatever the A record says, and failed
# validations count against a 5/hour rate limit — so this checks DNS first and
# refuses rather than burning attempts.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP=${1:?usage: attach-domain.sh <app> <domain> [alias...]}
shift
DOMAINS="$*"
[ -n "$DOMAINS" ] || { echo "✗ at least one domain is required" >&2; exit 1; }

LETSENCRYPT_EMAIL=${LETSENCRYPT_EMAIL:-}
SRV_ROOT=${SRV_ROOT:-/srv}

ok()  { printf '\033[0;32m  ✓ %s\033[0m\n' "$*"; }
die() { printf '\033[0;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

for name in $DOMAINS; do
  case "$name" in
    *[!a-zA-Z0-9.-]*) die "invalid domain '${name}' — letters, digits, dots and dashes only" ;;
  esac
done

PORT=$(awk -F= -v a="$APP" '$1 == a {print $2}' "${SRV_ROOT}/ports.env" | head -1)
[ -n "$PORT" ] || die "'${APP}' is not in ${SRV_ROOT}/ports.env — run app-setup.sh first"

PUBLIC_IP=$(curl -fsS --max-time 8 https://api.ipify.org) || die "could not determine this host's public IP"
for name in $DOMAINS; do
  resolved=$(getent hosts "$name" | awk '{print $1}' | head -1)
  [ -n "$resolved" ] || die "${name} does not resolve — add an A record for ${PUBLIC_IP} first"
  [ "$resolved" = "$PUBLIC_IP" ] || die "${name} resolves to ${resolved}, not this host (${PUBLIC_IP})"
  ok "${name} → ${PUBLIC_IP}"
done

# Rewrite server_name in place, then let certbot add TLS to the same file.
SITE=$(grep -rl "proxy_pass http://127.0.0.1:${PORT};" /etc/nginx/conf.d/ 2>/dev/null | head -1 || true)
[ -n "$SITE" ] || die "no vhost found proxying to port ${PORT}"
sudo sed -i "s|^\( *server_name \).*;|\1${DOMAINS};|" "$SITE"
sudo nginx -t
sudo systemctl reload nginx
ok "server_name in ${SITE} is now: ${DOMAINS}"

# certbot needs a contact address or an explicit opt-out, so this refuses to
# guess. LETSENCRYPT_EMAIL=none registers without one: renewal is automatic,
# and the address only matters as a warning if renewal ever silently stops.
[ -n "$LETSENCRYPT_EMAIL" ] || \
  die "set LETSENCRYPT_EMAIL=you@example.com (or =none to register without one) and re-run"
if [ "$LETSENCRYPT_EMAIL" = "none" ]; then
  ACCOUNT_ARGS=(--register-unsafely-without-email)
else
  ACCOUNT_ARGS=(-m "$LETSENCRYPT_EMAIL")
fi

CERT_ARGS=()
for name in $DOMAINS; do CERT_ARGS+=(-d "$name"); done

# Staging first. A failed production validation spends one of five per hour;
# a staging one is free and fails for the same reasons — DNS, the VCN, the
# nginx plugin, SELinux.
sudo certbot certonly --nginx --dry-run "${CERT_ARGS[@]}" \
  --non-interactive --agree-tos "${ACCOUNT_ARGS[@]}" \
  || die "staging dry run failed — fix that before spending a production attempt"
ok "staging dry run passed"

sudo certbot --nginx "${CERT_ARGS[@]}" \
  --non-interactive --agree-tos "${ACCOUNT_ARGS[@]}" --redirect
ok "HTTPS live — certbot-renew.timer handles renewal"

