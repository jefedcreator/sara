import { orderService } from "@/backend/services/order";
import { HttpException } from "@/utils/exceptions";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const publicOrderSchema = z
  .object({
    productSlug: z.string().min(1, "productSlug is required"),
    optionId: z.string().min(1, "optionId is required"),
    quantity: z.number().int().min(1, "quantity must be a whole number from 1"),
    fulfilment: z.enum(["DELIVERY", "PICKUP"]),
    deliveryAddress: z.string().max(500).nullable().optional(),
    clientName: z.string().min(1, "clientName is required").max(255),
    clientPhone: z.string().min(7, "clientPhone is required").max(20),
    clientEmail: z
      .string()
      .email("clientEmail must be a valid email")
      .nullable()
      .optional(),
  })
  .strict();

/**
 * @description Public (unauthenticated) product checkout + Paystack payment
 *              init. Used by the checkout sheet on a product page.
 * @body { productSlug, optionId, quantity, fulfilment, deliveryAddress?, clientName, clientPhone, clientEmail? }
 */
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json().catch(() => null);
    const parsed = publicOrderSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json(
        {
          status: 422,
          message: first
            ? `${first.path.join(".")}: ${first.message}`
            : "Validation failed",
        },
        { status: 422 },
      );
    }

    const result = await orderService.startCheckout(parsed.data);

    return NextResponse.json(
      {
        status: 201,
        message: "Order created successfully. Complete payment to confirm.",
        data: {
          ...result.order,
          paymentUrl: result.paymentUrl,
          paymentReference: result.paymentReference,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof HttpException) {
      return NextResponse.json(
        { status: error.statusCode, message: error.message },
        { status: error.statusCode },
      );
    }
    console.error(
      "[Public Order] Error:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { status: 500, message: "Internal server error" },
      { status: 500 },
    );
  }
}
