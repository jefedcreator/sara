import {
  pathParamValidatorMiddleware,
  queryValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import { catalogService } from "@/backend/services/catalog";
import {
  serviceDetailQueryValidatorSchema,
  type ServiceDetailQueryValidatorSchema,
} from "@/backend/validators/service.validator";
import { slugParamValidator } from "@/backend/validators/index.validator";
import { InternalServerErrorException } from "@/utils/exceptions";
import { NextResponse } from "next/server";
import type { ApiResponse } from "@/types";

export const runtime = "nodejs";

/**
 * @queryParams ServiceDetailQueryValidatorSchema
 * @description Public (unauthenticated) service details + availability.
 *              SLOT: ?date. NIGHTLY: ?from&to (nights in [from, to)).
 *              DAILY: ?date&units (pickup times). Used by the booking page.
 * @auth none
 */
export const GET = withMiddleware<unknown, ServiceDetailQueryValidatorSchema>(
  async (request) => {
    try {
      const { slug } = request.params! as { slug: string };
      const query = request.query!;
      const service = await catalogService.getPublicService(slug, {
        date: query.date ?? new Date().toISOString().split("T")[0]!,
        from: query.from,
        to: query.to,
        units: query.units,
      });
      if (!service) {
        const notFound: ApiResponse<null> = {
          status: 404,
          message: "Service not found",
          data: null,
        };
        return NextResponse.json(notFound, { status: 404 });
      }
      const response: ApiResponse<typeof service> = {
        status: 200,
        message: "Service retrieved successfully",
        data: service,
      };
      return NextResponse.json(response);
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while fetching the service: ${error.message}`,
      );
    }
  },
  [
    pathParamValidatorMiddleware(slugParamValidator),
    queryValidatorMiddleware(serviceDetailQueryValidatorSchema),
  ],
);
