#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# download-nigeria-data.sh
#
# Downloads Nigeria OSM data and extracts Lagos-region tiles for Atlas.
# Run this ONCE before first Atlas startup.
#
# Usage:
#   chmod +x scripts/download-nigeria-data.sh
#   ./scripts/download-nigeria-data.sh
# ---------------------------------------------------------------------------
set -euo pipefail

DATA_DIR="${ATLAS_DATA_DIR:-./atlas/data}"
OSM_DIR="$DATA_DIR/osm"
TILE_DIR="$DATA_DIR/tiles"

mkdir -p "$OSM_DIR" "$TILE_DIR"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Atlas — Downloading Nigeria data for Lagos region"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. Download Nigeria OSM PBF (~200 MB)
NIGERIA_PBF="$OSM_DIR/nigeria-latest.osm.pbf"
if [ -f "$NIGERIA_PBF" ]; then
  echo "✓ Nigeria PBF already exists, skipping download"
else
  echo "→ Downloading Nigeria OSM PBF from Geofabrik..."
  curl -L --progress-bar -o "$NIGERIA_PBF" \
    "https://download.geofabrik.de/africa/nigeria-latest.osm.pbf"
  echo "✓ Nigeria PBF downloaded"
fi

# 2. Download PMTiles extract for the Lagos region
#    Lagos bounding box: roughly 3.0°N to 7.0°N, 2.5°E to 4.5°E
#    This covers Lagos State, Ogun, and parts of Oyo for routing context.
LAGOS_PMTILES="$TILE_DIR/lagos.pmtiles"
if [ -f "$LAGOS_PMTILES" ]; then
  echo "✓ Lagos PMTiles already exists, skipping download"
else
  if command -v pmtiles &>/dev/null; then
    echo "→ Extracting Lagos-region tiles via pmtiles CLI..."
    pmtiles extract \
      "https://build.protomaps.com/$(date +%Y%m%d).pmtiles" \
      "$LAGOS_PMTILES" \
      --bbox="2.5,3.0,4.5,7.0" \
      --maxzoom=15
    echo "✓ Lagos tiles extracted"
  else
    echo "⚠ pmtiles CLI not found — skipping tile extraction."
    echo "  Install: brew install pmtiles (macOS) or download from"
    echo "  https://github.com/protomaps/go-pmtiles/releases"
    echo ""
    echo "  Atlas will still work for geocoding and routing without tiles."
    echo "  The frontend will use Protomaps CDN tiles instead."
  fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Data download complete!"
echo ""
echo "  Next steps:"
echo "  1. Build geocoding + search indices:"
echo "     docker compose run atlas atlas-ingest \\"
echo "       --osm-dir /data/osm --output-dir /data/indices"
echo "     docker compose run atlas atlas-ingest \\"
echo "       --osm-dir /data/osm --output-dir /data/indices --build-search-index"
echo ""
echo "  2. Start everything:"
echo "     docker compose up"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
