#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Make room for an upload. Run over SSH by the deploy workflow BEFORE rsync,
# piped from the CI checkout (`ssh … bash -s -- … < deploy/prune-releases.sh`)
# so it works even when no release on the server contains it yet.
#
#   bash -s -- <APP_DIR> <KEEP_RELEASES> <TARGET_RELEASE_DIR> <MIN_FREE_MB>
#
# Why this exists: deploy.sh prunes only after a SUCCESSFUL deploy. A failed
# deploy, or an upload that died partway (the "No space left on device" rsync
# failure), left its release behind, and every retry landed on a fuller disk.
#
# Prints disk usage first, so a CI log alone shows where the space went.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
APP_DIR="$1"; KEEP="$2"; TARGET="$3"; MIN_FREE_MB="$4"
RELEASES="${APP_DIR}/releases"
mkdir -p "$RELEASES"

echo "── disk before pruning ──"
df -h "$RELEASES" || true
du -sh "$RELEASES"/*/ "${APP_DIR}/shared/logs" 2>/dev/null | sort -h || true

live=""
if [ -L "${APP_DIR}/current" ]; then live=$(readlink -f "${APP_DIR}/current"); fi

# A partial upload of THIS commit (a retry after a failed rsync) holds full,
# un-hardlinked copies; start it clean. Never when it is the live release.
if [ -d "$TARGET" ] && [ "$(readlink -f "$TARGET")" != "$live" ]; then
  echo "removing stale upload $TARGET"
  rm -rf "$TARGET"
fi

# Keep the live release and the KEEP-1 newest others; delete the rest,
# including releases whose deploy failed (deploy.sh prunes only on success).
kept=0
for dir in $(ls -1dt "$RELEASES"/*/ 2>/dev/null); do
  dir=${dir%/}
  [ "$(readlink -f "$dir")" = "$live" ] && continue
  if [ "$kept" -lt $((KEEP - 1)) ]; then kept=$((kept + 1)); continue; fi
  echo "removing old release $dir"
  rm -rf "$dir"
done

free_mb=$(df -Pm "$RELEASES" | awk 'NR==2 {print $4}')
echo "── free after pruning: ${free_mb} MB ──"
if [ "$free_mb" -lt "$MIN_FREE_MB" ]; then
  echo "::error::Only ${free_mb} MB free on the server after pruning $(basename "$APP_DIR") releases; an upload can need ${MIN_FREE_MB} MB. Something besides those releases is filling the disk — see the usage above."
  exit 1
fi
