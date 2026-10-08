import { bookingService } from "@/backend/services/booking";
import { appBaseUrl, publicUrl } from "@/utils/url";
import { HttpException } from "@/utils/exceptions";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const publicBookingSchema = z
  .object({
    serviceSlug: z.string().min(1, "serviceSlug is required"),
    startTime: z.coerce.date(),
    // Slot services only; stays and rentals send units and the server works out the end.
    endTime: z.coerce.date().optional(),
    units: z.coerce.number().int().min(1).max(90).optional(),
    clientName: z.string().min(1, "clientName is required").max(255),
    clientEmail: z.string().email("clientEmail must be a valid email").optional(),
    clientPhone: z.string().max(20).optional(),
    notes: z.string().max(1000).optional(),
  })
  .strict();

/**
 * @description Public (unauthenticated) booking creation + Paystack payment init.
 *              Used by the customer-facing booking page.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = publicBookingSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json(
        { status: 422, message: first ? `${first.path.join(".")}: ${first.message}` : "Validation failed" },
        { status: 422 },
      );
    }

    const data = parsed.data;
    const result = await bookingService.createWithPayment({
      serviceSlug: data.serviceSlug,
      startTime: data.startTime,
      endTime: data.endTime,
      units: data.units,
      clientName: data.clientName,
      clientEmail: data.clientEmail,
      clientPhone: data.clientPhone,
      // Back to Sara after checkout, handled by Paystack webhook GET redirect.
      callbackUrl: (booking) =>
        `${appBaseUrl()}/api/webhooks/paystack?b=${encodeURIComponent(booking.slug)}`,
    });

    return NextResponse.json(
      {
        status: 201,
        message: "Booking created successfully. Complete payment to confirm.",
        data: {
          ...result.booking,
          paymentUrl: result.paymentUrl,
          paymentReference: result.paymentReference,
        },
      },
      { status: 201 },
    );
  } catch (error: any) {
    if (error instanceof HttpException) {
      return NextResponse.json({ status: error.statusCode, message: error.message }, { status: error.statusCode });
    }
    console.error("[Public Booking] Error:", error?.message ?? error);
    return NextResponse.json({ status: 500, message: "Internal server error" }, { status: 500 });
  }
}
