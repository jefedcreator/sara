import { atlasService } from "@/backend/services/atlas";
import { InternalServerErrorException } from "@/utils/exceptions";
import { NextResponse } from "next/server";
import type { ApiResponse } from "types";
import type { AtlasGeocodeResult } from "types/atlas";
import { withMiddleware } from "@/backend/middleware";
import { optionalAuthMiddleware, queryValidatorMiddleware } from "@/backend/middleware";
import { atlasReverseQueryValidatorSchema, type AtlasReverseQueryValidatorSchema } from "@/backend/validators/atlas.validator";

/**
 * @queryParams AtlasReverseQueryValidatorSchema
 * @description Proxy to Atlas reverse-geocode. Converts coordinates to address.
 */
export const GET = withMiddleware<AtlasReverseQueryValidatorSchema>(
  async (request) => {
    try {
      const payload = request.query!;
      const { lat, lon, limit, lang } = payload;

      const results = await atlasService.reverseGeocode(lat, lon, {
        limit,
        lang,
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
  },
  [optionalAuthMiddleware, queryValidatorMiddleware(atlasReverseQueryValidatorSchema)],
);
