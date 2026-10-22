import { bodyValidatorMiddleware, withMiddleware } from "@/backend/middleware";
import { orderService } from "@/backend/services/order";
import {
  publicOrderValidatorSchema,
  type PublicOrderValidatorSchema,
} from "@/backend/validators/order.validator";
import { HttpException, InternalServerErrorException } from "@/utils/exceptions";
import { NextResponse } from "next/server";
import type { ApiResponse } from "types";

export const runtime = "nodejs";

type CheckoutStarted = Awaited<ReturnType<typeof orderService.startCheckout>>["order"] & {
  paymentUrl: string;
  paymentReference: string;
};

/**
 * @body PublicOrderValidatorSchema
 * @description Public (unauthenticated) product checkout + Paystack payment
 *              init. Used by the checkout sheet on a product page.
 */
export const POST = withMiddleware<PublicOrderValidatorSchema>(
  async (request) => {
    try {
      const result = await orderService.startCheckout(request.validatedData!);

      const response: ApiResponse<CheckoutStarted> = {
        status: 201,
        message: "Order created successfully. Complete payment to confirm.",
        data: {
          ...result.order,
          paymentUrl: result.paymentUrl,
          paymentReference: result.paymentReference,
        },
      };

      return NextResponse.json(response, { status: 201 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // A public route: never show a customer what broke inside.
      throw new InternalServerErrorException("Internal server error");
    }
  },
  [bodyValidatorMiddleware(publicOrderValidatorSchema)],
);
