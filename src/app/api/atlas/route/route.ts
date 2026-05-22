import { atlasService } from "@/backend/services/atlas";
import { InternalServerErrorException } from "@/utils/exceptions";
import { NextResponse } from "next/server";
import type { ApiResponse } from "types";
import type { AtlasRouteResult } from "types/atlas";
import { withMiddleware } from "@/backend/middleware";
import { optionalAuthMiddleware, bodyValidatorMiddleware } from "@/backend/middleware";
import { atlasRouteBodyValidatorSchema, type AtlasRouteBodyValidatorSchema } from "@/backend/validators/atlas.validator";

/**
 * @body { origin: { lat, lon }, destination: { lat, lon }, profile?: string }
 * @description Proxy to Atlas routing engine. Returns distance, duration,
 *              GeoJSON geometry, and turn-by-turn instructions.
 * @contentType application/json
 */
export const POST = withMiddleware<AtlasRouteBodyValidatorSchema>(
  async (request) => {
    try {
      const body = request.validatedData!;
      const { origin, destination, profile } = body;

      const result = await atlasService.route(
        { lat: origin.lat, lon: origin.lon },
        { lat: destination.lat, lon: destination.lon },
        profile,
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
  },
  [optionalAuthMiddleware, bodyValidatorMiddleware(atlasRouteBodyValidatorSchema)],
);
