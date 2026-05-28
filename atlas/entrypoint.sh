#!/bin/sh
# ---------------------------------------------------------------------------
# Atlas entrypoint — initialise data on first run, then start the server
#
# Downloads the Nigeria OSM PBF, extracts only the Lagos metro region using
# osmium, builds geocoding/search indices, then starts the server.
# The Lagos extract keeps the in-memory road graph small (~2M nodes vs 22M).
# ---------------------------------------------------------------------------
set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Atlas Maps Server — Starting up"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

OSM_DIR="${ATLAS_OSM_DIR:-/data/osm}"
TILE_DIR="${ATLAS_TILE_DIR:-/data/tiles}"
GEOCODE_INDEX_DIR="${ATLAS_GEOCODE_INDEX_DIR:-/data/indices/geocode-index}"
SEARCH_INDEX_DIR="${ATLAS_SEARCH_INDEX_DIR:-/data/indices/search-index}"
OUTPUT_DIR="$(dirname "${GEOCODE_INDEX_DIR}")"

# Lagos metro bounding box (generous, covers Ikorodu → Badagry, Epe → islands)
LAGOS_BBOX="2.7,6.3,3.9,6.75"

# ── Marker file to skip re-init on subsequent starts ──────────────────────
INIT_MARKER="/data/.atlas-init-done"

if [ -f "$INIT_MARKER" ]; then
  echo "✓ Data already initialised (marker found), skipping download & ingest"
else
  echo "→ First run detected — downloading data and building indices..."
  echo ""

  # ── 1. Download Nigeria PBF and extract Lagos region ───────────────────
  OSM_FILE="$OSM_DIR/lagos.osm.pbf"
  NIGERIA_TMP="$OSM_DIR/nigeria-full.osm.pbf"
  MIN_SIZE_BYTES=1048576  # 1 MB minimum for a valid PBF

  if [ -f "$OSM_FILE" ]; then
    FILE_SIZE=$(stat -c%s "$OSM_FILE" 2>/dev/null || stat -f%z "$OSM_FILE" 2>/dev/null || echo 0)
    if [ "$FILE_SIZE" -lt "$MIN_SIZE_BYTES" ]; then
      echo "⚠ Lagos PBF looks truncated (${FILE_SIZE} bytes), re-downloading..."
      rm -f "$OSM_FILE"
    else
      echo "✓ Lagos OSM PBF already exists: $OSM_FILE ($(echo "$FILE_SIZE" | awk '{printf "%.0f MB", $1/1048576}'))"
    fi
  fi

  if [ ! -f "$OSM_FILE" ]; then
    echo "→ Downloading Nigeria OSM PBF from Geofabrik..."
    if curl -L -f --retry 3 --retry-delay 5 --progress-bar \
        -o "${NIGERIA_TMP}" \
        "https://download.geofabrik.de/africa/nigeria-latest.osm.pbf"; then
      echo "✓ Downloaded Nigeria PBF"

      echo "→ Extracting Lagos metro region (bbox: ${LAGOS_BBOX})..."
      osmium extract -b "$LAGOS_BBOX" "$NIGERIA_TMP" -o "$OSM_FILE" --overwrite --strategy=simple
      echo "✓ Lagos extract created: $OSM_FILE"

      # Remove the large Nigeria file to save disk space
      rm -f "$NIGERIA_TMP"
      echo "✓ Cleaned up full Nigeria PBF"
    else
      rm -f "${NIGERIA_TMP}"
      echo "⚠ Failed to download OSM data. Routing will be unavailable."
    fi
  fi

  # ── 2. Tiles ───────────────────────────────────────────────────────────
  echo "⚠ pmtiles CLI not available in container — skipping tile download."
  echo "  The frontend will use Protomaps CDN tiles instead."

  # ── 3. Build geocoding index ───────────────────────────────────────────
  if [ -f "$OSM_FILE" ]; then
    if [ -d "$GEOCODE_INDEX_DIR" ] && [ "$(ls -A "$GEOCODE_INDEX_DIR" 2>/dev/null)" ]; then
      echo "✓ Geocode index already exists"
    else
      echo "→ Building geocoding index..."
      # Remove empty dir so atlas-ingest doesn't skip it
      rm -rf "$GEOCODE_INDEX_DIR"
      if atlas-ingest --osm-dir "$OSM_DIR" --output-dir "$OUTPUT_DIR"; then
        echo "✓ Geocoding index built"
      else
        echo "⚠ Geocoding index build failed — geocoding will be unavailable."
      fi
    fi

    # ── 4. Build search index ────────────────────────────────────────────
    if [ -d "$SEARCH_INDEX_DIR" ] && [ "$(ls -A "$SEARCH_INDEX_DIR" 2>/dev/null)" ]; then
      echo "✓ Search index already exists"
    else
      echo "→ Building search index..."
      # Remove empty dir so atlas-ingest doesn't skip it
      rm -rf "$SEARCH_INDEX_DIR"
      if atlas-ingest --osm-dir "$OSM_DIR" --output-dir "$OUTPUT_DIR" --build-search-index; then
        echo "✓ Search index built"
      else
        echo "⚠ Search index build failed — search will be unavailable."
      fi
    fi
  fi

  # Mark initialisation as complete
  touch "$INIT_MARKER"
  echo ""
  echo "✓ Data initialisation complete!"
fi

echo ""
echo "→ Starting atlas-server on port ${ATLAS_PORT:-3001}..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exec atlas-server "$@"
