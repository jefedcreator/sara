"use client";

import { useCallback, useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// ---------------------------------------------------------------------------
// AtlasMap — Reusable MapLibre GL component with Protomaps tiles
//
// Props:
//   center      – [lng, lat] initial centre (default: Lagos)
//   zoom        – initial zoom level (default: 12)
//   markers     – array of { lng, lat, color?, popup? } to render
//   routeGeoJson – GeoJSON LineString to render as a route line
//   onMapClick  – callback when the map is clicked with { lng, lat }
//   className   – additional CSS classes
//   interactive – whether the map allows interaction (default: true)
// ---------------------------------------------------------------------------

export interface MapMarker {
  lng: number;
  lat: number;
  color?: string;
  popup?: string;
}

interface AtlasMapProps {
  center?: [number, number];
  zoom?: number;
  markers?: MapMarker[];
  routeGeoJson?: GeoJSON.LineString | null;
  onMapClick?: (coords: { lng: number; lat: number }) => void;
  className?: string;
  interactive?: boolean;
}

/** Lagos, Nigeria */
const LAGOS_CENTER: [number, number] = [3.3792, 6.5244];
const DEFAULT_ZOOM = 12;

/**
 * Protomaps free CDN tile URL.
 * Uses the basemaps-assets CDN for the "dark" style.
 * Swap "dark" → "light" | "white" | "grayscale" for other themes.
 */
const PROTOMAPS_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  name: "Protomaps Dark",
  sources: {
    protomaps: {
      type: "vector",
      url: "https://api.protomaps.com/tiles/v4.json?key=1003ad9b72bda211",
      attribution:
        '© <a href="https://openstreetmap.org">OpenStreetMap</a> contributors, <a href="https://protomaps.com">Protomaps</a>',
    },
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#0a0a0f" },
    },
    {
      id: "water",
      type: "fill",
      source: "protomaps",
      "source-layer": "water",
      paint: { "fill-color": "#0d1b2a" },
    },
    {
      id: "landuse-park",
      type: "fill",
      source: "protomaps",
      "source-layer": "landuse",
      filter: ["==", "pmap:kind", "park"],
      paint: { "fill-color": "#0f1f0f", "fill-opacity": 0.6 },
    },
    {
      id: "roads-highway",
      type: "line",
      source: "protomaps",
      "source-layer": "roads",
      filter: ["==", "pmap:kind", "highway"],
      paint: {
        "line-color": "#2a3a2a",
        "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.5, 14, 3],
      },
    },
    {
      id: "roads-major",
      type: "line",
      source: "protomaps",
      "source-layer": "roads",
      filter: ["in", "pmap:kind", "major_road", "medium_road"],
      paint: {
        "line-color": "#1e2a1e",
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.3, 14, 2],
      },
    },
    {
      id: "roads-minor",
      type: "line",
      source: "protomaps",
      "source-layer": "roads",
      filter: ["==", "pmap:kind", "minor_road"],
      paint: {
        "line-color": "#151f15",
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.2, 16, 1],
      },
      minzoom: 11,
    },
    {
      id: "buildings",
      type: "fill",
      source: "protomaps",
      "source-layer": "buildings",
      paint: { "fill-color": "#111818", "fill-opacity": 0.7 },
      minzoom: 13,
    },
    {
      id: "places-label",
      type: "symbol",
      source: "protomaps",
      "source-layer": "places",
      layout: {
        "text-field": "{name}",
        "text-size": ["interpolate", ["linear"], ["zoom"], 6, 10, 14, 14],
        "text-font": ["Noto Sans Regular"],
      },
      paint: {
        "text-color": "#6ee7b7",
        "text-halo-color": "#0a0a0f",
        "text-halo-width": 1.5,
      },
    },
  ],
  glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
};

export default function AtlasMap({
  center = LAGOS_CENTER,
  zoom = DEFAULT_ZOOM,
  markers = [],
  routeGeoJson = null,
  onMapClick,
  className = "",
  interactive = true,
}: AtlasMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  // ── Initialise map ────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: PROTOMAPS_STYLE,
      center,
      zoom,
      interactive,
      attributionControl: {},
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    if (onMapClick) {
      map.on("click", (e) => {
        onMapClick({ lng: e.lngLat.lng, lat: e.lngLat.lat });
      });
    }

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Update markers ────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove previous markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    markers.forEach((m) => {
      const marker = new maplibregl.Marker({
        color: m.color ?? "#10b981",
      })
        .setLngLat([m.lng, m.lat])
        .addTo(map);

      if (m.popup) {
        marker.setPopup(
          new maplibregl.Popup({ offset: 25 }).setHTML(
            `<div style="color:#000;font-size:13px;padding:4px 0">${m.popup}</div>`,
          ),
        );
      }

      markersRef.current.push(marker);
    });

    // Fit bounds if multiple markers
    if (markers.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      markers.forEach((m) => bounds.extend([m.lng, m.lat]));
      map.fitBounds(bounds, { padding: 60, maxZoom: 15 });
    } else if (markers.length === 1) {
      map.flyTo({ center: [markers[0]!.lng, markers[0]!.lat], zoom: 14 });
    }
  }, [markers]);

  // ── Render route ──────────────────────────────────────────────────────
  const updateRoute = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    // Wait for style to load
    if (!map.isStyleLoaded()) {
      map.once("styledata", updateRoute);
      return;
    }

    // Remove existing route layer + source
    if (map.getLayer("atlas-route-line")) map.removeLayer("atlas-route-line");
    if (map.getSource("atlas-route")) map.removeSource("atlas-route");

    if (!routeGeoJson) return;

    map.addSource("atlas-route", {
      type: "geojson",
      data: {
        type: "Feature",
        properties: {},
        geometry: routeGeoJson,
      },
    });

    map.addLayer({
      id: "atlas-route-line",
      type: "line",
      source: "atlas-route",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": "#10b981",
        "line-width": 4,
        "line-opacity": 0.85,
      },
    });
  }, [routeGeoJson]);

  useEffect(() => {
    updateRoute();
  }, [updateRoute]);

  return (
    <div
      ref={containerRef}
      className={`w-full rounded-lg overflow-hidden ${className}`}
      style={{ minHeight: 320 }}
    />
  );
}
