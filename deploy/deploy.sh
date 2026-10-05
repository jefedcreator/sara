#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Deploy one release. Run over SSH by the repo's GitHub Actions workflow.
#
#   APP=sara APP_PORT=3003 RELEASE_DIR=/srv/sara/releases/<sha> \
#     DB_SYNC_CMD='npx prisma migrate deploy' bash deploy/deploy.sh
#
# Contract: on exit 0 the new release is live and answering. On any failure the
# PREVIOUS release is live and answering, and the exit code is non-zero. There
# is no state in between.
#
# Health is checked on 127.0.0.1, never the public URL: the Oracle VCN ingress
# is a separate concern and this script must report the app's health honestly
# whether or not the world can reach it.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP=${APP:?APP is required}
APP_PORT=${APP_PORT:?APP_PORT is required}
RELEASE_DIR=${RELEASE_DIR:?RELEASE_DIR is required}
DB_SYNC_CMD=${DB_SYNC_CMD:-}
KEEP_RELEASES=${KEEP_RELEASES:-3}
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-60}
DB_SYNCED=0

SRV_ROOT=${SRV_ROOT:-/srv}
APP_DIR="${SRV_ROOT}/${APP}"
CURRENT="${APP_DIR}/current"
SHARED="${APP_DIR}/shared"

log()  { printf '\n\033[1;36m→ %s\033[0m\n' "$*"; }
ok()   { printf '\033[0;32m  ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[0;33m  ! %s\033[0m\n' "$*"; }
die()  { printf '\033[0;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ -d "$RELEASE_DIR" ] || die "release ${RELEASE_DIR} does not exist"
[ -s "${SHARED}/.env" ] || die "${SHARED}/.env is missing or empty — refusing to start"

# Remember where to go back to. Empty on a first deploy.
PREVIOUS=""
if [ -L "$CURRENT" ]; then
  PREVIOUS=$(readlink -f "$CURRENT")
fi

log "Deploying ${APP} → ${RELEASE_DIR}"
[ -n "$PREVIOUS" ] && echo "  previous: ${PREVIOUS}" || echo "  first deploy"

# ── Wire shared state into the release ──────────────────────────────────────
ln -sfn "${SHARED}/.env"  "${RELEASE_DIR}/.env"
ln -sfn "${SHARED}/logs"  "${RELEASE_DIR}/logs"
ok "shared .env and logs linked"

# ── Atomic swap ─────────────────────────────────────────────────────────────
# `ln -sfn` onto an existing symlink would create a link INSIDE the target
# directory. Build a temporary link and rename over it instead: `mv -T` is a
# single rename syscall, so no request ever observes a missing `current`.
swap_to() {
  ln -sfn "$1" "${APP_DIR}/current.tmp"
  mv -Tf "${APP_DIR}/current.tmp" "$CURRENT"
}
swap_to "$RELEASE_DIR"
ok "current → $(readlink "$CURRENT")"

# ── Restart under pm2 ───────────────────────────────────────────────────────
start_app() {
  ( cd "$CURRENT" && \
    APP_NAME="$APP" APP_PORT="$APP_PORT" \
    pm2 startOrRestart deploy/ecosystem.config.cjs --update-env )
}

rollback() {
  printf '\033[0;31m✗ deploy failed — rolling back\033[0m\n' >&2
  if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ]; then
    if swap_to "$PREVIOUS"; then
      start_app || true
      echo "  rolled back to ${PREVIOUS}" >&2
    else
      echo "  ✗ ROLLBACK FAILED — ${CURRENT} still points at the bad release ${RELEASE_DIR}" >&2
      echo "    restore by hand: ln -sfn ${PREVIOUS} ${APP_DIR}/current.tmp && mv -Tf ${APP_DIR}/current.tmp ${CURRENT}" >&2
    fi
  else
    pm2 delete "$APP" 2>/dev/null || true
    rm -f "$CURRENT"
    echo "  no previous release to roll back to; ${APP} stopped" >&2
  fi
  if [ "$DB_SYNCED" = "1" ]; then
    echo "  ! the database schema was ALREADY migrated before this failure." >&2
    echo "    The restored release ${PREVIOUS} is now running against a newer schema." >&2
    echo "    Verify it tolerates the change, or roll the migration back by hand." >&2
  fi
  echo "--- last 50 log lines ---" >&2
  pm2 logs "$APP" --lines 50 --nostream 2>/dev/null || true
  exit 1
}

if [ -n "$DB_SYNC_CMD" ]; then
  log "Syncing database schema"
  ( cd "$CURRENT" && eval "$DB_SYNC_CMD" ) || rollback
  DB_SYNCED=1
  ok "schema synced"
fi

log "Restarting under pm2"
start_app || rollback
pm2 save >/dev/null || warn "pm2 save failed — apps will not resurrect on reboot until it succeeds"
ok "pm2 state saved"

# ── Health check ────────────────────────────────────────────────────────────
log "Waiting for ${APP} on 127.0.0.1:${APP_PORT} (up to ${HEALTH_TIMEOUT}s)"
deadline=$(( SECONDS + HEALTH_TIMEOUT ))
while [ "$SECONDS" -lt "$deadline" ]; do
  if curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:${APP_PORT}/api/health" || \
     curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:${APP_PORT}/"; then
    ok "healthy"
    log "Pruning old releases (keeping ${KEEP_RELEASES})"
    if [ "$KEEP_RELEASES" -lt 1 ]; then
      warn "KEEP_RELEASES=${KEEP_RELEASES} is invalid — refusing to prune"
    else
      ( cd "${APP_DIR}/releases" && \
        ls -1dt ./*/ 2>/dev/null | tail -n "+$((KEEP_RELEASES + 1))" | xargs -r rm -rf ) \
        || warn "pruning failed — old releases remain, deploy is unaffected"
    fi
    ok "deploy complete — logs: pm2 logs ${APP}"
    exit 0
  fi
  sleep 2
done

rollback

