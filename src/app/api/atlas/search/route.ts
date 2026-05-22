import { atlasService } from "@/backend/services/atlas";
import { InternalServerErrorException } from "@/utils/exceptions";
import { NextResponse, type NextRequest } from "next/server";
import type { ApiResponse } from "types";
import type { AtlasSearchResponse } from "types/atlas";

/**
 * @queryParams q, lat (required), lon (required), category, radius_km, limit, country
 * @description Proxy to Atlas POI search. Returns nearby places/businesses
 *              ranked by distance from the given coordinates.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") ?? "";
    const lat = Number(searchParams.get("lat"));
    const lon = Number(searchParams.get("lon"));

    if (isNaN(lat) || isNaN(lon)) {
      return NextResponse.json(
        { status: 400, message: "Missing required parameters: lat, lon" },
        { status: 400 },
      );
    }

    const results = await atlasService.search(q, { lat, lon }, {
      category: searchParams.get("category") ?? undefined,
      radius_km: Number(searchParams.get("radius_km")) || undefined,
      limit: Number(searchParams.get("limit")) || 10,
      country: searchParams.get("country") ?? "NG",
    });

    const response: ApiResponse<AtlasSearchResponse> = {
      status: 200,
      message: "Search results retrieved",
      data: results,
    };

    return NextResponse.json(response);
  } catch (error: any) {
    if (error.statusCode) throw error;
    throw new InternalServerErrorException(
      `Search failed: ${error.message}`,
    );
  }
}
