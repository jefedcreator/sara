import {
  authMiddleware,
  bodyValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import { customerService } from "@/backend/services/customer";
import {
  mergeCustomerValidatorSchema,
  type MergeCustomerValidatorSchema,
} from "@/backend/validators/customer.validator";
import {
  HttpException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import type { Customer } from "@prisma/client";
import { NextResponse } from "next/server";
import type { ApiResponse } from "types";

/**
 * @body MergeCustomerValidatorSchema
 * @description Merges one customer into another, moving every booking,
 *              invoice, receipt and payment to the kept customer.
 * @contentType application/json
 * @auth bearer
 */
export const POST = withMiddleware<MergeCustomerValidatorSchema>(
  async (request) => {
    try {
      const business = request.user!.business;
      if (!business) {
        throw new NotFoundException("Business not found for this user");
      }

      const { keepId, mergeId } = request.validatedData!;
      const customer = await customerService.merge(
        business.id,
        keepId,
        mergeId,
      );

      const response: ApiResponse<Customer> = {
        status: 200,
        message: "Customers merged successfully",
        data: customer,
      };

      return NextResponse.json(response);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        `An error occurred while merging customers: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
  [authMiddleware, bodyValidatorMiddleware(mergeCustomerValidatorSchema)],
);
