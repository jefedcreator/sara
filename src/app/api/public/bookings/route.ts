import {
  bodyValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import { bookingService } from "@/backend/services/booking";
import {
  publicBookingValidatorSchema,
  type PublicBookingValidatorSchema,
} from "@/backend/validators/booking.validator";
import {
  InternalServerErrorException,
} from "@/utils/exceptions";
import { appBaseUrl } from "@/utils/url";
import { NextResponse } from "next/server";
import type { ApiResponse } from "@/types";

export const runtime = "nodejs";

/**
 * @body PublicBookingValidatorSchema
 * @description Public (unauthenticated) booking creation + Paystack payment init.
 *              Used by the customer-facing booking page.
 * @contentType application/json
 * @auth none
 */
export const POST = withMiddleware<PublicBookingValidatorSchema>(
  async (request) => {
    try {
      const data = request.validatedData!;
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

      const response: ApiResponse<typeof result.booking & {
        paymentUrl: string | null;
        paymentReference: string;
      }> = {
        status: 201,
        message: "Booking created successfully. Complete payment to confirm.",
        data: {
          ...result.booking,
          paymentUrl: result.paymentUrl,
          paymentReference: result.paymentReference,
        },
      };
      return NextResponse.json(response, { status: 201 });
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while creating the booking: ${error.message}`,
      );
    }
  },
  [bodyValidatorMiddleware(publicBookingValidatorSchema)],
);
