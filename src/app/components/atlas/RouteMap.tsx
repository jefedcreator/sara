"use client";

import { useCallback, useEffect, useState } from "react";
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

export default function RouteMap({
  origin,
  destination,
  businessName = "Business",
  className = "",
}: RouteMapProps) {
  const [routeData, setRouteData] = useState<AtlasRouteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // ── Fetch route ───────────────────────────────────────────────────────
  const fetchRoute = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/atlas/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: { lat: origin.lat, lon: origin.lng },
          destination: { lat: destination.lat, lon: destination.lng },
          profile: "car",
        }),
      });

      const json = await res.json();

      if (!res.ok || json.status >= 400) {
        throw new Error(json.message ?? "Routing failed");
      }

      setRouteData(json.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [origin.lat, origin.lng, destination.lat, destination.lng]);

  useEffect(() => {
    fetchRoute();
  }, [fetchRoute]);

  // ── Markers ───────────────────────────────────────────────────────────
  const markers: MapMarker[] = [
    {
      lng: origin.lng,
      lat: origin.lat,
      color: "#3b82f6", // blue for client
      popup: "Your location",
    },
    {
      lng: destination.lng,
      lat: destination.lat,
      color: "#10b981", // emerald for business
      popup: businessName,
    },
  ];

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
      <div className="flex items-center gap-4 rounded-lg border border-white/10 bg-zinc-900/80 px-4 py-2.5 text-sm">
        {isLoading ? (
          <div className="flex items-center gap-2 text-zinc-400">
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-600 border-t-emerald-400" />
            Computing route…
          </div>
        ) : error ? (
          <span className="text-red-400">⚠ {error}</span>
        ) : (
          <>
            {/* Distance */}
            <div className="flex items-center gap-1.5">
              <svg
                className="h-4 w-4 text-emerald-400"
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
              <span className="font-medium text-zinc-100">{distanceKm} km</span>
            </div>

            <div className="h-4 w-px bg-white/10" />

            {/* Duration */}
            <div className="flex items-center gap-1.5">
              <svg
                className="h-4 w-4 text-emerald-400"
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
              <span className="font-medium text-zinc-100">
                {durationMin} min
              </span>
            </div>

            <div className="h-4 w-px bg-white/10" />

            {/* Profile */}
            <span className="text-xs text-zinc-500">by car</span>
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
        <details className="rounded-lg border border-white/10 bg-zinc-900/80">
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:text-emerald-300">
            Turn-by-turn directions ({routeData.instructions.length} steps)
          </summary>
          <ol className="max-h-60 overflow-y-auto px-4 pb-3">
            {routeData.instructions.map((step, i) => (
              <li
                key={i}
                className="flex items-start gap-3 border-t border-white/5 py-2 text-sm"
              >
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-[10px] font-bold text-emerald-400">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-zinc-200">{step.text}</p>
                  <p className="text-xs text-zinc-500">
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
