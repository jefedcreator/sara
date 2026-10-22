import {
  authMiddleware,
  bodyValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import {
  productService,
  type StockChange,
} from "@/backend/services/product";
import {
  stockAdjustValidatorSchema,
  type StockAdjustValidatorSchema,
} from "@/backend/validators/product.validator";
import {
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { NextResponse } from "next/server";
import type { ApiResponse, ProductOptionDto } from "types";

/**
 * @body StockAdjustValidatorSchema
 * @pathParams slug
 * @description Changes one product option's stock by `add` (which may be
 *              negative) or to an exact `set` value. Exactly one of the two is
 *              required.
 * @contentType application/json
 * @auth bearer
 */
export const POST = withMiddleware<StockAdjustValidatorSchema>(
  async (request) => {
    try {
      const user = request.user!;
      const business = user.business;

      if (!business) {
        throw new NotFoundException("Business not found");
      }

      if (business.ownerId !== user.id) {
        throw new ForbiddenException(
          "You do not have permission to manage products for this business",
        );
      }

      const { optionId, add, set } = request.validatedData!;
      const change: StockChange =
        add !== undefined ? { add } : { set: set as number };

      const option = await productService.adjustStock(
        business.id,
        optionId,
        change,
      );

      const response: ApiResponse<ProductOptionDto> = {
        status: 200,
        message: "Stock updated successfully",
        data: option as unknown as ProductOptionDto,
      };

      return NextResponse.json(response);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        `An error occurred while updating stock: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
  [authMiddleware, bodyValidatorMiddleware(stockAdjustValidatorSchema)],
);
