import {
  authMiddleware,
  bodyValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import { orderService } from "@/backend/services/order";
import {
  updateOrderValidatorSchema,
  type UpdateOrderValidatorSchema,
} from "@/backend/validators/order.validator";
import {
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { NextResponse } from "next/server";
import type { ApiResponse, OrderDto } from "types";

/**
 * @pathParams slug
 * @description Retrieves one order of the authenticated user's business by its
 *              slug, with its lines, customer and linked documents.
 * @auth bearer
 */
export const GET = withMiddleware<unknown>(
  async (request, { params }) => {
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

      const { slug } = params;
      if (!slug) {
        throw new NotFoundException("Order not found");
      }

      const order = await orderService.getBySlug(business.id, slug);

      const response: ApiResponse<OrderDto> = {
        status: 200,
        message: "Order retrieved successfully",
        data: order as unknown as OrderDto,
      };

      return NextResponse.json(response);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        `An error occurred while fetching the order: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
  [authMiddleware],
);

/**
 * @body UpdateOrderValidatorSchema
 * @pathParams slug
 * @description Moves an order to ready, completed or cancelled, or switches it
 *              between delivery and pickup with the address delivery needs.
 * @contentType application/json
 * @auth bearer
 */
export const PUT = withMiddleware<UpdateOrderValidatorSchema>(
  async (request, { params }) => {
    try {
      const user = request.user!;
      const business = user.business;

      if (!business) {
        throw new NotFoundException("Business not found for this user");
      }

      if (business.ownerId !== user.id) {
        throw new ForbiddenException(
          "You do not have permission to manage orders for this business",
        );
      }

      const { slug } = params;
      if (!slug) {
        throw new NotFoundException("Order not found");
      }

      const payload = request.validatedData!;
      const order =
        "status" in payload
          ? await orderService.setStatus(business.id, slug, payload.status)
          : await orderService.setFulfilment(business.id, slug, payload);

      const response: ApiResponse<OrderDto> = {
        status: 200,
        message: "Order updated successfully",
        data: order as unknown as OrderDto,
      };

      return NextResponse.json(response);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        `An error occurred while updating the order: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
  [authMiddleware, bodyValidatorMiddleware(updateOrderValidatorSchema)],
);
