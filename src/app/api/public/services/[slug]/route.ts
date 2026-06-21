import { availabilityService } from "@/backend/services/availability";
import { db } from "@/server/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * @description Public (unauthenticated) service details + availability for a date.
 *              Used by the customer-facing booking page.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await context.params;
    const url = new URL(request.url);
    const date = url.searchParams.get("date") ?? new Date().toISOString().split("T")[0]!;

    const service = await db.service.findFirst({
      where: { slug, isActive: true },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        image: true,
        price: true,
        duration: true,
        businessId: true,
        business: { select: { name: true, currency: true } },
      },
    });

    if (!service) {
      return NextResponse.json({ status: 404, message: "Service not found" }, { status: 404 });
    }

    const availableSlots = await availabilityService.getAvailableSlots({
      businessId: service.businessId,
      serviceId: service.id,
      date,
    });

    const slots = availableSlots.map((slot) => ({
      startTime: slot.startTime.toISOString(),
      endTime: slot.endTime.toISOString(),
      isAvailable: slot.isAvailable,
    }));

    return NextResponse.json({
      status: 200,
      message: "Service retrieved successfully",
      data: {
        slug: service.slug,
        name: service.name,
        description: service.description,
        image: service.image,
        price: service.price,
        duration: service.duration,
        currency: service.business.currency,
        businessName: service.business.name,
        slots,
      },
    });
  } catch (error: any) {
    console.error("[Public Service] Error:", error?.message ?? error);
    return NextResponse.json({ status: 500, message: "Internal server error" }, { status: 500 });
  }
}
