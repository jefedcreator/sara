import {
  authMiddleware,
  queryValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import { customerService } from "@/backend/services/customer";
import {
  customerQueryValidatorSchema,
  type CustomerQueryValidatorSchema,
} from "@/backend/validators/customer.validator";
import {
  HttpException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { NextResponse } from "next/server";
import type { CustomerListItem, PaginatedApiResponse } from "types";

/**
 * @queryParams CustomerQueryValidatorSchema
 * @description Retrieves the authenticated business's customers, searched by
 *              name, phone or email and sorted by most recent activity.
 * @auth bearer
 */
export const GET = withMiddleware<unknown, CustomerQueryValidatorSchema>(
  async (request) => {
    try {
      const business = request.user!.business;
      if (!business) {
        throw new NotFoundException("Business not found for this user");
      }

      const page = request.query?.page ?? 1;
      const size = request.query?.size ?? 10;
      const { data, total } = await customerService.list(business.id, {
        query: request.query?.query,
        page,
        size,
      });

      const response: PaginatedApiResponse<CustomerListItem[]> = {
        status: 200,
        message: "Customers retrieved successfully",
        data,
        total,
        page,
        size,
        totalPages: Math.ceil(total / size),
      };

      return NextResponse.json(response);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        `An error occurred while fetching customers: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
  [authMiddleware, queryValidatorMiddleware(customerQueryValidatorSchema)],
);
