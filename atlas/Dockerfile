# ---------------------------------------------------------------------------
# Atlas Maps Server — multi-stage Docker build
# Builds the Rust server and ingest binaries from source.
# ---------------------------------------------------------------------------
FROM rust:slim-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev protobuf-compiler git curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Clone Atlas at a specific commit / branch (pin for reproducibility)
RUN git clone --depth 1 https://github.com/jefedcreator/atlas.git .

# Build release binaries
RUN cargo build --release -p atlas-server -p atlas-ingest

# ---------------------------------------------------------------------------
# Runtime image — minimal Debian with just the binaries + data
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl osmium-tool \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /atlas

# Copy built binaries
COPY --from=builder /build/target/release/atlas-server /usr/local/bin/atlas-server
COPY --from=builder /build/target/release/atlas-ingest /usr/local/bin/atlas-ingest

# Copy data initialisation script
COPY init-data.sh /usr/local/bin/init-data.sh
RUN chmod +x /usr/local/bin/init-data.sh

# Copy entrypoint (auto-downloads data on first startup)
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Data directories (will be bind-mounted or populated by entrypoint)
RUN mkdir -p /data/osm /data/tiles /data/indices/geocode-index /data/indices/search-index /data/contributions /data/telemetry

# Default environment (can be overridden in compose.yaml)
ENV ATLAS_TILE_SOURCE=local \
    ATLAS_TILE_DIR=/data/tiles \
    ATLAS_OSM_DIR=/data/osm \
    ATLAS_GEOCODE_INDEX_DIR=/data/indices/geocode-index \
    ATLAS_SEARCH_INDEX_DIR=/data/indices/search-index \
    ATLAS_ROUTE_DIR=/data/indices \
    ATLAS_LANDMARK_PATH=/data/indices/landmarks.bin \
    ATLAS_PLACES_PATH=/data/indices/places.bin \
    ATLAS_SPEED_DATA_PATH=/data/indices/speed_data.bin \
    ATLAS_CONTRIBUTIONS_DIR=/data/contributions \
    ATLAS_TELEMETRY_DIR=/data/telemetry \
    ATLAS_PORT=3001 \
    ATLAS_AUTH_ENABLED=false \
    RUST_LOG=info

EXPOSE 3001

# First startup downloads ~200 MB OSM + builds indices, so allow up to 15 min
HEALTHCHECK --interval=30s --timeout=10s --start-period=900s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

ENTRYPOINT ["entrypoint.sh"]

