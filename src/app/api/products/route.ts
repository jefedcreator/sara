import {
  authMiddleware,
  queryValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import { productService } from "@/backend/services/product";
import {
  productQueryValidatorSchema,
  productValidatorSchema,
  type ProductQueryValidatorSchema,
} from "@/backend/validators/product.validator";
import {
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from "@/utils/exceptions";
import { NextResponse } from "next/server";
import type { ApiResponse, ProductDto } from "types";

import { photosFrom, uploadPhotos } from "./photos";

/**
 * @body ProductValidatorSchema
 * @description Creates a product for the authenticated user's business. Send
 *              `name`, `description`, `price`, `tracksStock`, an `options` JSON
 *              array and between one and five repeatable `photos` files.
 * @contentType multipart/form-data
 * @auth bearer
 */
export const POST = withMiddleware<unknown>(
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

      const parsed = productValidatorSchema.safeParse(request.parsedBody ?? {});
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new UnprocessableEntityException(
          issue?.path.length
            ? `${issue.path.join(".")}: ${issue.message}`
            : (issue?.message ?? "Validation failed"),
        );
      }

      const photoUrls = await uploadPhotos(
        business.id,
        photosFrom(request),
      );
      const product = await productService.create(
        business.id,
        parsed.data,
        photoUrls,
      );

      const response: ApiResponse<ProductDto> = {
        status: 201,
        message: "Product created successfully",
        data: product as unknown as ProductDto,
      };

      return NextResponse.json(response, { status: 201 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        `An error occurred while creating the product: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
  [authMiddleware],
);

/**
 * @queryParams ProductQueryValidatorSchema
 * @description Retrieves the authenticated business's products with their
 *              active options. Pass `includeInactive=true` to include paused
 *              products.
 * @auth bearer
 */
export const GET = withMiddleware<unknown, ProductQueryValidatorSchema>(
  async (request) => {
    try {
      const user = request.user!;
      const business = user.business;

      if (!business) {
        throw new NotFoundException("Business not found for this user");
      }

      if (business.ownerId !== user.id) {
        throw new ForbiddenException(
          "You do not have permission to view products for this business",
        );
      }

      const products = await productService.list(business.id, {
        includeInactive: request.query?.includeInactive === true,
      });

      const response: ApiResponse<ProductDto[]> = {
        status: 200,
        message: "Products retrieved successfully",
        data: products as unknown as ProductDto[],
      };

      return NextResponse.json(response);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        `An error occurred while fetching products: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
  [authMiddleware, queryValidatorMiddleware(productQueryValidatorSchema)],
);
