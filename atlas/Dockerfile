# ---------------------------------------------------------------------------
# Atlas Maps Server — multi-stage Docker build
# Builds the Rust server and ingest binaries from source.
# ---------------------------------------------------------------------------
FROM rust:1.82-slim-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev protobuf-compiler git curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Clone Atlas at a specific commit / branch (pin for reproducibility)
RUN git clone --depth 1 https://github.com/Augani/atlas.git .

# Build release binaries
RUN cargo build --release -p atlas-server -p atlas-ingest

# ---------------------------------------------------------------------------
# Runtime image — minimal Debian with just the binaries + data
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /atlas

# Copy built binaries
COPY --from=builder /build/target/release/atlas-server /usr/local/bin/atlas-server
COPY --from=builder /build/target/release/atlas-ingest /usr/local/bin/atlas-ingest

# Data directories (will be bind-mounted or populated by init script)
RUN mkdir -p /data/osm /data/tiles /data/indices /data/contributions

# Default environment (can be overridden in compose.yaml)
ENV ATLAS_TILE_SOURCE=local \
    ATLAS_TILE_DIR=/data/tiles \
    ATLAS_OSM_DIR=/data/osm \
    ATLAS_INDEX_DIR=/data/indices \
    ATLAS_PORT=3001 \
    ATLAS_AUTH_ENABLED=false \
    RUST_LOG=info

EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

ENTRYPOINT ["atlas-server"]
