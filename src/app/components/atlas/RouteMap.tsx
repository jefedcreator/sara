"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import AtlasMap, { type MapMarker } from "./AtlasMap";
import type { AtlasRouteResult } from "types/atlas";

// ---------------------------------------------------------------------------
// RouteMap — Displays a route between a client location and a business
//
// Fetches the route from Sara's Atlas proxy (POST /api/atlas/route)
// and renders it on the map alongside origin + destination markers.
// ---------------------------------------------------------------------------

interface RouteMapProps {
  /** Client (origin) coordinates */
  origin: { lat: number; lng: number };
  /** Business (destination) coordinates */
  destination: { lat: number; lng: number };
  /** Business name for the destination marker popup */
  businessName?: string;
  /** Additional CSS classes */
  className?: string;
}

const routeKeys = {
  route: (
    origin: { lat: number; lng: number },
    destination: { lat: number; lng: number },
  ) =>
    [
      "atlas",
      "route",
      origin.lat,
      origin.lng,
      destination.lat,
      destination.lng,
      "car",
    ] as const,
};

async function fetchRoute(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
) {
  const res = await fetch("/api/atlas/route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      origin: { lat: origin.lat, lon: origin.lng },
      destination: { lat: destination.lat, lon: destination.lng },
      profile: "car",
    }),
  });

  const json = (await res.json()) as {
    data?: AtlasRouteResult;
    message?: string;
    status?: number;
  };

  if (!res.ok || (json.status && json.status >= 400)) {
    throw new Error(json.message ?? "Routing failed");
  }
  if (!json.data) throw new Error("Routing failed");

  return json.data;
}

export default function RouteMap({
  origin,
  destination,
  businessName = "Business",
  className = "",
}: RouteMapProps) {
  const route = useQuery({
    queryKey: routeKeys.route(origin, destination),
    queryFn: () => fetchRoute(origin, destination),
    staleTime: 5 * 60 * 1000,
  });
  const routeData = route.data ?? null;
  const error =
    route.error instanceof Error
      ? route.error.message
      : route.isError
        ? "Routing failed"
        : null;
  const isLoading = route.isPending;

  // ── Markers ───────────────────────────────────────────────────────────
  const markers: MapMarker[] = useMemo(
    () => [
      {
        lng: origin.lng,
        lat: origin.lat,
        color: "#0f1a14", // ink for the customer
        popup: "Your location",
      },
      {
        lng: destination.lng,
        lat: destination.lat,
        color: "#25d366", // accent for the business
        popup: businessName,
      },
    ],
    [businessName, destination.lat, destination.lng, origin.lat, origin.lng],
  );

  // ── Helpers ───────────────────────────────────────────────────────────
  const distanceKm = routeData
    ? (routeData.distance_m / 1000).toFixed(1)
    : null;
  const durationMin = routeData
    ? Math.ceil(routeData.duration_s / 60)
    : null;

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Route stats bar */}
      <div className="flex flex-wrap items-center gap-4 rounded-card border border-line bg-canvas px-4 py-2.5 text-sm">
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted">
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-accent-ink" />
            Computing route…
          </div>
        ) : error ? (
          <span className="text-danger">⚠ {error}</span>
        ) : (
          <>
            {/* Distance */}
            <div className="flex items-center gap-1.5">
              <svg
                className="h-4 w-4 text-accent-ink"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                />
              </svg>
              <span className="font-semibold text-ink">{distanceKm} km</span>
            </div>

            <div className="h-4 w-px bg-line" />

            {/* Duration */}
            <div className="flex items-center gap-1.5">
              <svg
                className="h-4 w-4 text-accent-ink"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span className="font-semibold text-ink">
                {durationMin} min
              </span>
            </div>

            <div className="h-4 w-px bg-line" />

            {/* Profile */}
            <span className="text-xs text-muted">by car</span>
          </>
        )}
      </div>

      {/* Map */}
      <AtlasMap
        markers={markers}
        routeGeoJson={routeData?.geometry ?? null}
        className="h-[400px]"
      />

      {/* Turn-by-turn instructions (collapsible) */}
      {routeData?.instructions && routeData.instructions.length > 0 && (
        <details className="rounded-card border border-line bg-canvas">
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-ink-2 transition-colors duration-200 ease-out-expo hover:text-accent-ink">
            Turn-by-turn directions ({routeData.instructions.length} steps)
          </summary>
          <ol className="max-h-60 overflow-y-auto px-4 pb-3">
            {routeData.instructions.map((step, i) => (
              <li
                key={i}
                className="flex items-start gap-3 border-t border-line py-2 text-sm"
              >
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-on-accent">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-ink">{step.text}</p>
                  <p className="text-xs text-muted">
                    {(step.distance_m / 1000).toFixed(1)} km ·{" "}
                    {Math.ceil(step.duration_s / 60)} min
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
