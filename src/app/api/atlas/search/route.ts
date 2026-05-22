import { optionalAuthMiddleware, queryValidatorMiddleware, withMiddleware } from "@/backend/middleware";
import { atlasService } from "@/backend/services/atlas";
import { atlasSearchQueryValidatorSchema, type AtlasSearchQueryValidatorSchema } from "@/backend/validators/atlas.validator";
import { InternalServerErrorException } from "@/utils/exceptions";
import { NextResponse } from "next/server";
import type { ApiResponse } from "types";
import type { AtlasSearchResponse } from "types/atlas";

/**
 * @queryParams AtlasSearchQueryValidatorSchema
 * @description Proxy to Atlas POI search. Returns nearby places/businesses
 *              ranked by distance from the given coordinates.
 */
export const GET = withMiddleware<AtlasSearchQueryValidatorSchema>(
  async (request) => {
    try {
      const payload = request.query!;
      const { q, lat, lon, category, radius_km, limit, country } = payload;

      const results = await atlasService.search(q, { lat, lon }, {
        category,
        radius_km,
        limit,
        country,
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
  },
  [optionalAuthMiddleware, queryValidatorMiddleware(atlasSearchQueryValidatorSchema)],
);
