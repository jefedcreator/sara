#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Multi-app host provisioning — Oracle Linux 9 / aarch64
#
# Server-wide and idempotent. This file is byte-identical in every project repo
# that deploys to this box, so running it from any of them is safe and running
# it twice is a no-op.
#
# Usage (as the deploy user — NOT root; it sudos only where it must):
#   bash deploy/bootstrap-oracle.sh
#
# Deliberately NOT done, because the box already has it or it must never be
# automated:
#   - swap            4 GiB swapfile is already active
#   - user creation   deploys run as the existing 'opc'
#   - firewall reset  firewalld already allows 80/443; a reset drops rules the
#                     box came with.
#   - sshd hardening  never reconfigure sshd from an unattended script
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

EPEL_REPO=${EPEL_REPO:-ol9_developer_EPEL}
SRV_ROOT=${SRV_ROOT:-/srv}
DEPLOY_USER=${DEPLOY_USER:-$(id -un)}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

log()  { printf '\n\033[1;36m→ %s\033[0m\n' "$*"; }
ok()   { printf '\033[0;32m  ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[0;33m  ! %s\033[0m\n' "$*"; }
die()  { printf '\n\033[0;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ── 0. Preflight ────────────────────────────────────────────────────────────
[ "$EUID" -ne 0 ] || die "Run as the deploy user, not root: bash deploy/bootstrap-oracle.sh"

. /etc/os-release
case "${ID}${ID_LIKE:-}" in
  *fedora*|*rhel*) ;;
  *) die "Expected the Oracle Linux / RHEL family, got '${PRETTY_NAME}'" ;;
esac

ARCH=$(uname -m)
[ "$ARCH" = "aarch64" ] || warn "Expected aarch64, got ${ARCH} — package names may differ"

sudo -n true 2>/dev/null || die "Passwordless sudo is required for ${DEPLOY_USER}"

log "Provisioning ${PRETTY_NAME} (${ARCH}) for user ${DEPLOY_USER}"

# ── 1. Base packages ────────────────────────────────────────────────────────
log "Installing base packages"
sudo dnf install -y -q rsync logrotate policycoreutils-python-utils >/dev/null
ok "base packages present"

# ── 2. yarn ─────────────────────────────────────────────────────────────────
# The repos pin yarn@1.22.22 via packageManager. npm -g is enough; corepack is
# not enabled on this box.
log "Installing yarn"
if command -v yarn >/dev/null 2>&1; then
  ok "yarn $(yarn --version) already installed"
else
  sudo npm install -g --silent yarn >/dev/null
  ok "yarn $(yarn --version) installed"
fi

# ── 3. Chromium + Xvfb (for Puppeteer-based apps) ───────────────────────────
# Google Chrome has no ARM Linux build. Oracle ships chromium for aarch64 in
# its EPEL repo, which is present but disabled by default.
log "Installing chromium and Xvfb"
if ! command -v chromium-browser >/dev/null 2>&1; then
  sudo dnf install -y -q --enablerepo="${EPEL_REPO}" chromium >/dev/null
fi
CHROMIUM_BIN=$(command -v chromium-browser || command -v chromium || true)
[ -n "$CHROMIUM_BIN" ] || die "chromium install reported success but no binary found"
ok "$("$CHROMIUM_BIN" --version 2>/dev/null || echo chromium) at ${CHROMIUM_BIN}"

sudo dnf install -y -q xorg-x11-server-Xvfb >/dev/null
sudo tee /etc/systemd/system/xvfb.service >/dev/null <<'UNIT'
[Unit]
Description=X Virtual Frame Buffer (Xvfb) on display :99
After=network.target

[Service]
ExecStart=/usr/bin/Xvfb :99 -screen 0 1920x1080x24 -ac -nolisten tcp
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now xvfb >/dev/null
systemctl is-active --quiet xvfb || die "Xvfb failed to start — check: journalctl -u xvfb"
ok "Xvfb running on DISPLAY=:99"

# ── 4. SELinux ──────────────────────────────────────────────────────────────
# Without this every proxy_pass returns 502 while nginx and the app both look
# healthy. -P persists it across reboots.
log "Allowing nginx to make outbound connections (SELinux)"
if [ "$(getsebool httpd_can_network_connect | awk '{print $3}')" = "on" ]; then
  ok "httpd_can_network_connect already on"
else
  sudo setsebool -P httpd_can_network_connect 1
  ok "httpd_can_network_connect set on (persistent)"
fi

# ── 5. Firewall assertion (never a reset) ───────────────────────────────────
log "Checking firewalld"
for port in 80 443; do
  if sudo firewall-cmd --query-port="${port}/tcp" >/dev/null 2>&1; then
    ok "${port}/tcp already allowed"
  else
    sudo firewall-cmd --permanent --add-port="${port}/tcp" >/dev/null
    warn "${port}/tcp was closed — added"
    NEED_FW_RELOAD=1
  fi
done
if [ "${NEED_FW_RELOAD:-0}" = "1" ]; then
  sudo firewall-cmd --reload >/dev/null
  ok "firewalld reloaded"
fi

# ── 6. Application root ─────────────────────────────────────────────────────
log "Preparing ${SRV_ROOT}"
sudo install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$SRV_ROOT"
if [ ! -f "${SRV_ROOT}/ports.env" ]; then
  cat <<'PORTS' | sudo tee "${SRV_ROOT}/ports.env" >/dev/null
# Port registry — one line per app, `<app>=<port>`.
# Authoritative: deploy/app-setup.sh refuses to reuse a port listed here.
# Apps bind 127.0.0.1 only and are never opened in firewalld.
PORTS
  sudo chown "$DEPLOY_USER:$DEPLOY_USER" "${SRV_ROOT}/ports.env"
fi
ok "${SRV_ROOT} ready, port registry at ${SRV_ROOT}/ports.env"

# ── 7. nginx shared config ──────────────────────────────────────────────────
log "Installing shared nginx configuration"
sudo install -m 644 "${HERE}/nginx/00-shared.conf"  /etc/nginx/conf.d/00-shared.conf
sudo install -m 644 "${HERE}/nginx/00-default.conf" /etc/nginx/conf.d/00-default.conf
sudo nginx -t
sudo systemctl enable --now nginx >/dev/null
sudo systemctl reload nginx
ok "nginx configured and reloaded"

# ── 8. certbot ──────────────────────────────────────────────────────────────
log "Installing certbot"
sudo dnf install -y -q --enablerepo="${EPEL_REPO}" certbot python3-certbot-nginx >/dev/null
sudo systemctl enable --now certbot-renew.timer >/dev/null 2>&1 || \
  warn "certbot-renew.timer not available — renewals may need a cron entry"
ok "certbot $(certbot --version 2>&1 | awk '{print $2}') installed"

# ── 9. pm2 boot persistence ─────────────────────────────────────────────────
log "Configuring pm2 startup for ${DEPLOY_USER}"
if systemctl list-unit-files "pm2-${DEPLOY_USER}.service" >/dev/null 2>&1 && \
   systemctl is-enabled "pm2-${DEPLOY_USER}" >/dev/null 2>&1; then
  ok "pm2-${DEPLOY_USER}.service already enabled"
else
  sudo env PATH="$PATH:/usr/bin" pm2 startup systemd \
    -u "$DEPLOY_USER" --hp "$HOME" >/dev/null
  ok "pm2 will resurrect apps on reboot (after the first 'pm2 save')"
fi

# ── 10. Report VCN reachability ─────────────────────────────────────────────
log "Checking public reachability"
PUBLIC_IP=$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || echo "")
if [ -n "$PUBLIC_IP" ] && curl -fsS -o /dev/null --max-time 8 "http://${PUBLIC_IP}/" 2>/dev/null; then
  ok "port 80 reachable from the internet"
else
  warn "port 80 did NOT answer on ${PUBLIC_IP} from the VM itself."
  warn "Some networks do not hairpin, so verify from your laptop too:"
  warn "  curl -I http://${PUBLIC_IP}/"
  warn "firewalld allows it, so this is the Oracle VCN security list, which"
  warn "cannot be changed over SSH. In the Oracle Cloud console:"
  warn "  Networking → Virtual Cloud Networks → <your VCN> → Subnets →"
  warn "  <subnet> → Security Lists → <list> → Add Ingress Rules"
  warn "  Source 0.0.0.0/0, IP Protocol TCP, Destination Port Range 80,443"
fi

cat <<EOF

═══════════════════════════════════════════════════════
 ✅ Host provisioned

   User        : ${DEPLOY_USER}
   App root    : ${SRV_ROOT}
   Ports       : ${SRV_ROOT}/ports.env
   Chromium    : ${CHROMIUM_BIN}

 Next: set up an app —
   bash deploy/app-setup.sh <app> <port> <hostname...>
═══════════════════════════════════════════════════════
EOF

