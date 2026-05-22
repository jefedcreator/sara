import { atlasService } from "@/backend/services/atlas";
import { InternalServerErrorException } from "@/utils/exceptions";
import { NextResponse, type NextRequest } from "next/server";
import type { ApiResponse } from "types";
import type { AtlasGeocodeResult } from "types/atlas";

/**
 * @queryParams q (required), limit, country, lang
 * @description Proxy to Atlas forward-geocode. Returns address suggestions
 *              with lat/lon for the autocomplete component.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q");

    if (!q || !q.trim()) {
      return NextResponse.json(
        { status: 400, message: "Missing required query parameter: q", data: [] },
        { status: 400 },
      );
    }

    const results = await atlasService.geocode(q, {
      limit: Number(searchParams.get("limit")) || 5,
      country: searchParams.get("country") ?? "NG",
      lang: searchParams.get("lang") ?? "en",
    });

    const response: ApiResponse<AtlasGeocodeResult[]> = {
      status: 200,
      message: "Geocode results retrieved",
      data: results,
    };

    return NextResponse.json(response);
  } catch (error: any) {
    if (error.statusCode) throw error;
    throw new InternalServerErrorException(
      `Geocoding failed: ${error.message}`,
    );
  }
}
