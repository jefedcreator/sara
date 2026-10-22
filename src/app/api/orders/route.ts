import {
  authMiddleware,
  queryValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import { orderService } from "@/backend/services/order";
import {
  orderQueryValidatorSchema,
  type OrderQueryValidatorSchema,
} from "@/backend/validators/order.validator";
import {
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { NextResponse } from "next/server";
import type { OrderDto, PaginatedApiResponse } from "types";

/**
 * @queryParams OrderQueryValidatorSchema
 * @description Retrieves the authenticated business's orders, newest first
 *              for completed and cancelled ones and oldest first for the new
 *              and ready queue. Unpaid checkouts are never listed.
 * @auth bearer
 */
export const GET = withMiddleware<unknown, OrderQueryValidatorSchema>(
  async (request) => {
    try {
      const user = request.user!;
      const business = user.business;

      if (!business) {
        throw new NotFoundException("Business not found for this user");
      }

      if (business.ownerId !== user.id) {
        throw new ForbiddenException(
          "You do not have permission to view orders for this business",
        );
      }

      const page = request.query?.page ?? 1;
      const size = request.query?.size ?? 10;
      const { data, total } = await orderService.list(business.id, {
        status: request.query?.status,
        page,
        size,
      });

      const response: PaginatedApiResponse<OrderDto[]> = {
        status: 200,
        message: "Orders retrieved successfully",
        data: data as unknown as OrderDto[],
        total,
        page,
        size,
        totalPages: Math.ceil(total / size),
      };

      return NextResponse.json(response);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        `An error occurred while fetching orders: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
  [authMiddleware, queryValidatorMiddleware(orderQueryValidatorSchema)],
);
