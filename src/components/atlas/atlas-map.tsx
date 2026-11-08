"use client";

import { useCallback, useMemo, useRef } from "react";
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
      paint: { "background-color": "#f4f7f5" }, // surface
    },
    {
      id: "water",
      type: "fill",
      source: "protomaps",
      "source-layer": "water",
      paint: { "fill-color": "#dbe6e4" },
    },
    {
      id: "landuse-park",
      type: "fill",
      source: "protomaps",
      "source-layer": "landuse",
      filter: ["==", "pmap:kind", "park"],
      paint: { "fill-color": "#e8f9ee", "fill-opacity": 1 }, // accent-soft
    },
    {
      id: "roads-highway",
      type: "line",
      source: "protomaps",
      "source-layer": "roads",
      filter: ["==", "pmap:kind", "highway"],
      paint: {
        "line-color": "#cfd8d3",
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
        "line-color": "#dde4e0",
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
        "line-color": "#e5ebe7", // line
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.2, 16, 1],
      },
      minzoom: 11,
    },
    {
      id: "buildings",
      type: "fill",
      source: "protomaps",
      "source-layer": "buildings",
      paint: { "fill-color": "#e9eeeb", "fill-opacity": 1 },
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
        "text-color": "#5a665f", // muted
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    },
  ],
  glyphs:
    "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
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
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const routeSyncQueuedRef = useRef(false);
  const latestPropsRef = useRef({
    center,
    zoom,
    markers,
    routeGeoJson,
    onMapClick,
    interactive,
  });
  latestPropsRef.current = {
    center,
    zoom,
    markers,
    routeGeoJson,
    onMapClick,
    interactive,
  };

  const markerKey = useMemo(
    () =>
      markers
        .map((marker) =>
          [marker.lng, marker.lat, marker.color ?? "", marker.popup ?? ""].join(
            ":",
          ),
        )
        .join("|"),
    [markers],
  );
  const routeKey = useMemo(
    () =>
      routeGeoJson ? JSON.stringify(routeGeoJson.coordinates) : "no-route",
    [routeGeoJson],
  );

  const removeMarkers = useCallback(() => {
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];
  }, []);

  const syncMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const nextMarkers = latestPropsRef.current.markers;

    removeMarkers();

    nextMarkers.forEach((m) => {
      const marker = new maplibregl.Marker({
        color: m.color ?? "#25d366", // accent
      })
        .setLngLat([m.lng, m.lat])
        .addTo(map);

      if (m.popup) {
        marker.setPopup(
          new maplibregl.Popup({ offset: 25 }).setHTML(
            `<div style="color:#0f1a14;font-size:13px;padding:4px 0">${m.popup}</div>`,
          ),
        );
      }

      markersRef.current.push(marker);
    });

    // Fit bounds if multiple markers
    if (nextMarkers.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      nextMarkers.forEach((m) => bounds.extend([m.lng, m.lat]));
      map.fitBounds(bounds, { padding: 60, maxZoom: 15 });
    } else if (nextMarkers.length === 1) {
      map.flyTo({
        center: [nextMarkers[0]!.lng, nextMarkers[0]!.lat],
        zoom: 14,
      });
    }
  }, [removeMarkers]);

  // ── Render route ──────────────────────────────────────────────────────
  const syncRoute = useCallback(function syncRoute() {
    const map = mapRef.current;
    if (!map) return;

    // Wait for style to load
    if (!map.isStyleLoaded()) {
      if (!routeSyncQueuedRef.current) {
        routeSyncQueuedRef.current = true;
        void map.once("styledata", () => {
          routeSyncQueuedRef.current = false;
          syncRoute();
        });
      }
      return;
    }

    // Remove existing route layer + source
    if (map.getLayer("atlas-route-line")) map.removeLayer("atlas-route-line");
    if (map.getSource("atlas-route")) map.removeSource("atlas-route");

    const nextRoute = latestPropsRef.current.routeGeoJson;
    if (!nextRoute) return;

    map.addSource("atlas-route", {
      type: "geojson",
      data: {
        type: "Feature",
        properties: {},
        geometry: nextRoute,
      },
    });

    map.addLayer({
      id: "atlas-route-line",
      type: "line",
      source: "atlas-route",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": "#075e54", // accent-ink
        "line-width": 4,
        "line-opacity": 0.9,
      },
    });
  }, []);

  const mapNodeRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) {
        removeMarkers();
        mapRef.current?.remove();
        mapRef.current = null;
        routeSyncQueuedRef.current = false;
        return;
      }
      if (mapRef.current) return;

      const props = latestPropsRef.current;
      const map = new maplibregl.Map({
        container: node,
        style: PROTOMAPS_STYLE,
        center: props.center,
        zoom: props.zoom,
        interactive: props.interactive,
        attributionControl: {},
      });

      map.addControl(new maplibregl.NavigationControl(), "top-right");
      map.on("click", (e) => {
        latestPropsRef.current.onMapClick?.({
          lng: e.lngLat.lng,
          lat: e.lngLat.lat,
        });
      });

      mapRef.current = map;
      syncMarkers();
      syncRoute();
    },
    [removeMarkers, syncMarkers, syncRoute],
  );

  const markerSyncRef = useCallback(
    (node: HTMLSpanElement | null) => {
      if (node) syncMarkers();
    },
    [syncMarkers],
  );

  const routeSyncRef = useCallback(
    (node: HTMLSpanElement | null) => {
      if (node) syncRoute();
    },
    [syncRoute],
  );

  return (
    <>
      <div
        ref={mapNodeRef}
        className={`rounded-card w-full overflow-hidden ${className}`}
        style={{ minHeight: 320 }}
      />
      <span key={`markers:${markerKey}`} ref={markerSyncRef} hidden />
      <span key={`route:${routeKey}`} ref={routeSyncRef} hidden />
    </>
  );
}
