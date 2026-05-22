import { atlasService } from "@/backend/services/atlas";
import { InternalServerErrorException } from "@/utils/exceptions";
import { NextResponse } from "next/server";
import type { ApiResponse } from "types";
import type { AtlasGeocodeResult } from "types/atlas";
import { withMiddleware } from "@/backend/middleware";
import { optionalAuthMiddleware, queryValidatorMiddleware } from "@/backend/middleware";
import { atlasGeocodeQueryValidatorSchema, type AtlasGeocodeQueryValidatorSchema } from "@/backend/validators/atlas.validator";

/**
 * @queryParams AtlasGeocodeQueryValidatorSchema
 * @description Proxy to Atlas forward-geocode. Returns address suggestions
 *              with lat/lon for the autocomplete component.
 */
export const GET = withMiddleware<AtlasGeocodeQueryValidatorSchema>(
  async (request) => {
    try {
      const payload = request.query!;
      const { q, limit, country, lang } = payload;

      const results = await atlasService.geocode(q, {
        limit,
        country,
        lang,
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
  },
  [optionalAuthMiddleware, queryValidatorMiddleware(atlasGeocodeQueryValidatorSchema)],
);
