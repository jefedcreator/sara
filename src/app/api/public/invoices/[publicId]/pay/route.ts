import { withMiddleware } from "@/backend/middleware";
import { invoicePayments } from "@/backend/services/invoice/payment";
import {
  HttpException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { NextResponse } from "next/server";
import type { ApiResponse } from "types";

export const runtime = "nodejs";

/**
 * @pathParams publicId
 * @description Public (unauthenticated) payment start for an invoice, from the
 *              Pay button on the customer's invoice page. Charges the whole
 *              remaining balance through Paystack.
 */
export const POST = withMiddleware<unknown>(
  async (_request, { params }) => {
    try {
      const { publicId } = params;
      if (!publicId) throw new NotFoundException("Invoice not found");

      const result = await invoicePayments.start(publicId);

      const response: ApiResponse<{ paymentUrl: string }> = {
        status: 200,
        message: "Complete payment to settle this invoice.",
        data: { paymentUrl: result.paymentUrl },
      };

      return NextResponse.json(response);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // A public route: never show a customer what broke inside.
      throw new InternalServerErrorException("Internal server error");
    }
  },
  [],
);
