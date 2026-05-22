import axios, { type AxiosInstance } from "axios";
import type {
  AtlasGeocodeResponse,
  AtlasGeocodeResult,
  AtlasMatrixRequest,
  AtlasMatrixResult,
  AtlasProfile,
  AtlasRouteRequest,
  AtlasRouteResult,
  AtlasSearchResponse,
  LatLon,
} from "types/atlas";

// ---------------------------------------------------------------------------
// AtlasService — typed HTTP client for the self-hosted Atlas server
// ---------------------------------------------------------------------------

class AtlasService {
  private client: AxiosInstance;

  constructor() {
    const baseURL = process.env.ATLAS_API_URL ?? "http://localhost:3001";

    this.client = axios.create({
      baseURL,
      timeout: 10_000,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Geocoding ────────────────────────────────────────────────────────────

  /**
   * Forward-geocode a text query into coordinates.
   *
   * @param query - Free-text address or place name, e.g. "Lekki Phase 1, Lagos"
   * @param limit - Max results (1–50, default 5)
   * @param country - ISO country hint, e.g. "NG"
   * @param lang - Language code ("en" | "yo" | etc.)
   */
  async geocode(
    query: string,
    options?: { limit?: number; country?: string; lang?: string },
  ): Promise<AtlasGeocodeResult[]> {
    const { data } = await this.client.get<AtlasGeocodeResponse>(
      "/v1/geocode",
      {
        params: {
          q: query,
          limit: options?.limit ?? 5,
          country: options?.country ?? "NG",
          lang: options?.lang ?? "en",
        },
      },
    );
    return data.results;
  }

  /**
   * Reverse-geocode coordinates to an address / place name.
   */
  async reverseGeocode(
    lat: number,
    lon: number,
    options?: { limit?: number; lang?: string },
  ): Promise<AtlasGeocodeResult[]> {
    const { data } = await this.client.get<AtlasGeocodeResponse>(
      "/v1/reverse",
      {
        params: {
          lat,
          lon,
          limit: options?.limit ?? 5,
          lang: options?.lang ?? "en",
        },
      },
    );
    return data.results;
  }

  // ── Routing ──────────────────────────────────────────────────────────────

  /**
   * Compute a point-to-point route.
   *
   * @returns Route with distance_m, duration_s, GeoJSON geometry, and
   *          turn-by-turn instructions.
   */
  async route(
    origin: LatLon,
    destination: LatLon,
    profile: AtlasProfile = "car",
  ): Promise<AtlasRouteResult> {
    const body: AtlasRouteRequest = { origin, destination, profile };
    const { data } = await this.client.post<AtlasRouteResult>(
      "/v1/route",
      body,
    );
    return data;
  }

  /**
   * N×M distance / duration matrix.
   */
  async matrix(
    origins: LatLon[],
    destinations: LatLon[],
    profile: AtlasProfile = "car",
  ): Promise<AtlasMatrixResult> {
    const body: AtlasMatrixRequest = { origins, destinations, profile };
    const { data } = await this.client.post<AtlasMatrixResult>(
      "/v1/matrix",
      body,
    );
    return data;
  }

  // ── Search ───────────────────────────────────────────────────────────────

  /**
   * Search for places / POIs near a location.
   */
  async search(
    query: string,
    near: LatLon,
    options?: {
      category?: string;
      radius_km?: number;
      limit?: number;
      country?: string;
    },
  ): Promise<AtlasSearchResponse> {
    const { data } = await this.client.get<AtlasSearchResponse>("/v1/search", {
      params: {
        q: query,
        lat: near.lat,
        lon: near.lon,
        category: options?.category,
        radius_km: options?.radius_km,
        limit: options?.limit ?? 10,
        country: options?.country ?? "NG",
      },
    });
    return data;
  }

  // ── Health ───────────────────────────────────────────────────────────────

  async healthy(): Promise<boolean> {
    try {
      const { status } = await this.client.get("/health", { timeout: 3_000 });
      return status === 200;
    } catch {
      return false;
    }
  }
}

export const atlasService = new AtlasService();
