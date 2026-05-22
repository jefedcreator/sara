import { atlasService } from "@/backend/services/atlas";
import { InternalServerErrorException } from "@/utils/exceptions";
import { NextResponse, type NextRequest } from "next/server";
import type { ApiResponse } from "types";
import type { AtlasGeocodeResult } from "types/atlas";

/**
 * @queryParams lat (required), lon (required), limit, lang
 * @description Proxy to Atlas reverse-geocode. Converts coordinates to address.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const lat = Number(searchParams.get("lat"));
    const lon = Number(searchParams.get("lon"));

    if (isNaN(lat) || isNaN(lon)) {
      return NextResponse.json(
        { status: 400, message: "Missing required parameters: lat, lon", data: [] },
        { status: 400 },
      );
    }

    const results = await atlasService.reverseGeocode(lat, lon, {
      limit: Number(searchParams.get("limit")) || 5,
      lang: searchParams.get("lang") ?? "en",
    });

    const response: ApiResponse<AtlasGeocodeResult[]> = {
      status: 200,
      message: "Reverse geocode results retrieved",
      data: results,
    };

    return NextResponse.json(response);
  } catch (error: any) {
    if (error.statusCode) throw error;
    throw new InternalServerErrorException(
      `Reverse geocoding failed: ${error.message}`,
    );
  }
}
