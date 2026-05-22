import { atlasService } from "@/backend/services/atlas";
import { InternalServerErrorException } from "@/utils/exceptions";
import { NextResponse, type NextRequest } from "next/server";
import type { ApiResponse } from "types";
import type { AtlasRouteResult } from "types/atlas";

/**
 * @body { origin: { lat, lon }, destination: { lat, lon }, profile?: string }
 * @description Proxy to Atlas routing engine. Returns distance, duration,
 *              GeoJSON geometry, and turn-by-turn instructions.
 * @contentType application/json
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { origin, destination, profile } = body;

    if (
      !origin?.lat || !origin?.lon ||
      !destination?.lat || !destination?.lon
    ) {
      return NextResponse.json(
        { status: 400, message: "origin and destination with lat/lon are required" },
        { status: 400 },
      );
    }

    const result = await atlasService.route(
      { lat: origin.lat, lon: origin.lon },
      { lat: destination.lat, lon: destination.lon },
      profile ?? "car",
    );

    const response: ApiResponse<AtlasRouteResult> = {
      status: 200,
      message: "Route computed successfully",
      data: result,
    };

    return NextResponse.json(response);
  } catch (error: any) {
    if (error.statusCode) throw error;
    throw new InternalServerErrorException(
      `Routing failed: ${error.message}`,
    );
  }
}
