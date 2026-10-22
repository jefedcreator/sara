import {
  authMiddleware,
  bodyValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import {
  productService,
  type ProductUpdateInput,
} from "@/backend/services/product";
import {
  assertPhotoCount,
  photosFrom,
  uploadPhotos,
} from "@/backend/services/product/photos";
import {
  updateProductValidatorSchema,
  type UpdateProductValidatorSchema,
} from "@/backend/validators/product.validator";
import {
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { NextResponse } from "next/server";
import type { ApiResponse, ProductDto } from "types";

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

      const { slug } = params;
      if (!slug) {
        throw new NotFoundException("Product not found");
      }

      const product = await productService.getBySlug(business.id, slug);

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

      const { slug } = params;
      if (!slug) {
        throw new NotFoundException("Product not found");
      }

      // The middleware kept one photo; the whole list comes from the form.
      const { keepPhotos, ...rest } = request.validatedData!;
      delete rest.photos;
      const fields: Omit<typeof rest, "photos"> = rest;
      const newPhotos = photosFrom(request);

      // Without keepPhotos the product keeps the photos it has, and new ones
      // go after them. Count before uploading anything.
      const kept =
        keepPhotos ??
        (newPhotos.length > 0
          ? (await productService.getBySlug(business.id, slug)).photos
          : undefined);
      assertPhotoCount((kept?.length ?? 0) + newPhotos.length);

      const newPhotoUrls = await uploadPhotos(business.id, newPhotos);

      const patch: ProductUpdateInput = { ...fields };
      if (kept !== undefined || newPhotoUrls.length > 0) {
        patch.photos = [...(kept ?? []), ...newPhotoUrls];
      }

      const product = await productService.update(business.id, slug, patch);

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
  [authMiddleware, bodyValidatorMiddleware(updateProductValidatorSchema)],
);
