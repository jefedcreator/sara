import {
  authMiddleware,
  bodyValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import { customerService } from "@/backend/services/customer";
import {
  updateCustomerValidatorSchema,
  type UpdateCustomerValidatorSchema,
} from "@/backend/validators/customer.validator";
import {
  HttpException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import type { Customer } from "@prisma/client";
import { NextResponse } from "next/server";
import type { ApiResponse, CustomerDetail } from "types";

/**
 * @pathParams id
 * @description Retrieves one customer with their spent and owed totals and a
 *              newest-first timeline of bookings, invoices and receipts.
 * @auth bearer
 */
export const GET = withMiddleware<unknown>(
  async (request, { params }) => {
    try {
      const business = request.user!.business;
      if (!business) {
        throw new NotFoundException("Business not found for this user");
      }

      const response: ApiResponse<CustomerDetail> = {
        status: 200,
        message: "Customer retrieved successfully",
        data: await customerService.detail(business.id, params.id),
      };

      return NextResponse.json(response);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        `An error occurred while fetching the customer: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
  [authMiddleware],
);

/**
 * @body UpdateCustomerValidatorSchema
 * @pathParams id
 * @description Updates a customer's contact details for the authenticated
 *              user's business.
 * @contentType application/json
 * @auth bearer
 */
export const PUT = withMiddleware<UpdateCustomerValidatorSchema>(
  async (request, { params }) => {
    try {
      const business = request.user!.business;
      if (!business) {
        throw new NotFoundException("Business not found for this user");
      }

      const customer = await customerService.update(
        business.id,
        params.id,
        request.validatedData!,
      );

      const response: ApiResponse<Customer> = {
        status: 200,
        message: "Customer updated successfully",
        data: customer,
      };

      return NextResponse.json(response);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        `An error occurred while updating the customer: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
  [authMiddleware, bodyValidatorMiddleware(updateCustomerValidatorSchema)],
);
