import {
  authMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import {
  productService,
  type ProductUpdateInput,
} from "@/backend/services/product";
import {
  updateProductValidatorSchema,
  type UpdateProductValidatorSchema,
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

import { photosFrom, uploadPhotos } from "../photos";

/**
 * @pathParams slug
 * @description Retrieves one product of the authenticated user's business by
 *              its slug, with its active options in the owner's order.
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
          "You do not have permission to view products for this business",
        );
      }

      const product = await productService.getBySlug(business.id, params.slug);

      const response: ApiResponse<ProductDto> = {
        status: 200,
        message: "Product retrieved successfully",
        data: product as unknown as ProductDto,
      };

      return NextResponse.json(response);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        `An error occurred while fetching the product: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
  [authMiddleware],
);

/**
 * @body UpdateProductValidatorSchema
 * @pathParams slug
 * @description Updates a product for the authenticated user's business. Send
 *              any create field, `keepPhotos` as a JSON array of the existing
 *              photo URLs to keep (in order), any new `photos` files to append
 *              after them, and `isActive` as "true" or "false".
 * @contentType multipart/form-data
 * @auth bearer
 */
export const PUT = withMiddleware<UpdateProductValidatorSchema>(
  async (request, { params }) => {
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

      const parsed = updateProductValidatorSchema.safeParse(
        request.parsedBody ?? {},
      );
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new UnprocessableEntityException(
          issue?.path.length
            ? `${issue.path.join(".")}: ${issue.message}`
            : (issue?.message ?? "Validation failed"),
        );
      }

      const { keepPhotos, ...fields } = parsed.data;
      const newPhotoUrls = await uploadPhotos(
        business.id,
        photosFrom(request),
      );

      const patch: ProductUpdateInput = { ...fields };
      if (keepPhotos !== undefined || newPhotoUrls.length > 0) {
        patch.photos = [...(keepPhotos ?? []), ...newPhotoUrls];
      }

      const product = await productService.update(
        business.id,
        params.slug,
        patch,
      );

      const response: ApiResponse<ProductDto> = {
        status: 200,
        message: "Product updated successfully",
        data: product as unknown as ProductDto,
      };

      return NextResponse.json(response);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        `An error occurred while updating the product: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
  [authMiddleware],
);
