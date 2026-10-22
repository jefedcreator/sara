import { invoicePayments } from "@/backend/services/invoice/payment";
import { HttpException } from "@/utils/exceptions";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * @description Public (unauthenticated) payment start for an invoice, from the
 *              Pay button on the customer's invoice page. Charges the whole
 *              remaining balance through Paystack.
 * @returns { data: { paymentUrl } }
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ publicId: string }> },
) {
  try {
    const { publicId } = await context.params;
    const result = await invoicePayments.start(publicId);

    return NextResponse.json(
      {
        status: 200,
        message: "Complete payment to settle this invoice.",
        data: { paymentUrl: result.paymentUrl },
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof HttpException) {
      return NextResponse.json(
        { status: error.statusCode, message: error.message },
        { status: error.statusCode },
      );
    }
    console.error(
      "[Public Invoice Pay] Error:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { status: 500, message: "Internal server error" },
      { status: 500 },
    );
  }
}
