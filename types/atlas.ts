// ---------------------------------------------------------------------------
// Atlas API – TypeScript type definitions
// Matches the JSON shapes returned by the Atlas Rust server.
// ---------------------------------------------------------------------------

/** Coordinate pair used in route requests. */
export interface LatLon {
  lat: number;
  lon: number;
}

// ── Geocoding ──────────────────────────────────────────────────────────────

export interface AtlasAddress {
  street: string | null;
  city: string | null;
  region: string | null;
  postcode: string | null;
  country: string;
}

export interface AtlasGeocodeResult {
  /** Display name in the requested language. */
  name: string;
  lat: number;
  lon: number;
  address: AtlasAddress | null;
  category: string | null;
  /** "Osm" | "Overture" */
  source: string;
}

export interface AtlasGeocodeResponse {
  results: AtlasGeocodeResult[];
}

// ── Routing ────────────────────────────────────────────────────────────────

export type AtlasProfile = "car" | "motorcycle" | "bicycle" | "foot";

export interface AtlasRouteRequest {
  origin: LatLon;
  destination: LatLon;
  profile: AtlasProfile;
}

export interface AtlasInstruction {
  text: string;
  distance_m: number;
  duration_s: number;
}

export interface AtlasGeoJsonLineString {
  type: "LineString";
  /** [lon, lat] coordinate pairs */
  coordinates: [number, number][];
}

export interface AtlasRouteResult {
  /** Total distance in metres. */
  distance_m: number;
  /** Total duration in seconds. */
  duration_s: number;
  /** GeoJSON LineString geometry of the route. */
  geometry: AtlasGeoJsonLineString;
  /** Turn-by-turn instructions. */
  instructions: AtlasInstruction[];
}

// ── Matrix ─────────────────────────────────────────────────────────────────

export interface AtlasMatrixRequest {
  origins: LatLon[];
  destinations: LatLon[];
  profile: AtlasProfile;
}

export interface AtlasMatrixResult {
  distances_m: (number | null)[][];
  durations_s: (number | null)[][];
}

// ── Search (POI) ───────────────────────────────────────────────────────────

export interface AtlasSearchResult {
  name: string;
  lat: number;
  lon: number;
  category: string;
  address_summary: string | null;
  distance_km?: number;
}

export interface AtlasSearchResponse {
  results: AtlasSearchResult[];
}
