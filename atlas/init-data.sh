#!/bin/bash
# ---------------------------------------------------------------------------
# Atlas Data Initialiser — downloads Nigeria OSM data, tiles, and builds indices
# Run this once after the atlas container is built to populate the data volumes.
#
# Usage (from project root):
#   docker compose run --rm atlas sh /atlas/init-data.sh
#
# Or, if running outside Docker:
#   ./atlas/init-data.sh
# ---------------------------------------------------------------------------

set -euo pipefail

OSM_DIR="${ATLAS_OSM_DIR:-/data/osm}"
TILE_DIR="${ATLAS_TILE_DIR:-/data/tiles}"
INDEX_DIR="${ATLAS_GEOCODE_INDEX_DIR:-/data/indices/geocode-index}"
# Derive the parent dir from geocode index dir for the ingest --output-dir
OUTPUT_DIR="$(dirname "${INDEX_DIR}")"

echo "=== Atlas Data Initialiser ==="
echo "OSM_DIR:    $OSM_DIR"
echo "TILE_DIR:   $TILE_DIR"
echo "OUTPUT_DIR: $OUTPUT_DIR"
echo ""

# ── 1. Download Nigeria OSM PBF ────────────────────────────────────────────
OSM_FILE="$OSM_DIR/nigeria-latest.osm.pbf"
if [ -f "$OSM_FILE" ]; then
  echo "✓ OSM PBF already exists: $OSM_FILE"
else
  echo "→ Downloading Nigeria OSM PBF from Geofabrik (~200MB)..."
  curl -L --progress-bar -o "$OSM_FILE" \
    "https://download.geofabrik.de/africa/nigeria-latest.osm.pbf"
  echo "✓ Downloaded: $OSM_FILE"
fi

# ── 2. Download PMTiles for Nigeria region ─────────────────────────────────
TILE_FILE="$TILE_DIR/nigeria.pmtiles"
if [ -f "$TILE_FILE" ]; then
  echo "✓ PMTiles already exists: $TILE_FILE"
else
  echo "→ Downloading Nigeria PMTiles extract..."
  # Nigeria bbox: approximately lon 2.7-14.7, lat 4.2-13.9
  # Using protomaps daily build
  DATE=$(date +%Y%m%d)
  PMTILES_URL="https://build.protomaps.com/${DATE}.pmtiles"

  # Try to use pmtiles CLI if available, otherwise download a pre-built extract
  if command -v pmtiles &> /dev/null; then
    pmtiles extract "$PMTILES_URL" "$TILE_FILE" \
      --bbox="2.7,4.2,14.7,13.9" \
      --maxzoom=15
  else
    echo "  pmtiles CLI not available, downloading full Nigeria extract from Protomaps..."
    # Fallback: download a smaller Lagos-area extract
    # Lagos bbox: approximately lon 3.0-3.7, lat 6.3-6.8
    curl -L --progress-bar -o "$TILE_FILE" \
      "https://build.protomaps.com/${DATE}.pmtiles" \
      --header "Range: bytes=0-1" 2>/dev/null || true

    # If the above fails, we'll create a placeholder message
    if [ ! -s "$TILE_FILE" ] || [ "$(wc -c < "$TILE_FILE")" -lt 1000 ]; then
      rm -f "$TILE_FILE"
      echo "⚠ Could not download PMTiles. Tiles will not be available."
      echo "  Install pmtiles CLI and run:"
      echo "    pmtiles extract 'https://build.protomaps.com/YYYYMMDD.pmtiles' $TILE_FILE --bbox='2.7,4.2,14.7,13.9' --maxzoom=15"
    fi
  fi
  [ -f "$TILE_FILE" ] && echo "✓ Downloaded: $TILE_FILE"
fi

# ── 3. Build geocoding and search indices ──────────────────────────────────
if [ -d "$OUTPUT_DIR/geocode-index" ] && [ "$(ls -A "$OUTPUT_DIR/geocode-index" 2>/dev/null)" ]; then
  echo "✓ Geocode index already exists in $OUTPUT_DIR/geocode-index"
else
  echo "→ Building geocoding index..."
  atlas-ingest --osm-dir "$OSM_DIR" --output-dir "$OUTPUT_DIR"
  echo "✓ Geocoding index built"
fi

if [ -d "$OUTPUT_DIR/search-index" ] && [ "$(ls -A "$OUTPUT_DIR/search-index" 2>/dev/null)" ]; then
  echo "✓ Search index already exists in $OUTPUT_DIR/search-index"
else
  echo "→ Building search index..."
  atlas-ingest --osm-dir "$OSM_DIR" --output-dir "$OUTPUT_DIR" --build-search-index
  echo "✓ Search index built"
fi

echo ""
echo "=== Atlas data initialisation complete ==="
echo "You can now start the atlas server."
