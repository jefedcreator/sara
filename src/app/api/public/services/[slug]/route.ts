import { catalogService } from "@/backend/services/catalog";
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
    const dateParam = url.searchParams.get("date");
    if (dateParam !== null && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return NextResponse.json(
        { status: 422, message: "date must be in YYYY-MM-DD format" },
        { status: 422 },
      );
    }
    const date = dateParam ?? new Date().toISOString().split("T")[0]!;

    const service = await catalogService.getPublicService(slug, date);

    if (!service) {
      return NextResponse.json({ status: 404, message: "Service not found" }, { status: 404 });
    }

    return NextResponse.json({
      status: 200,
      message: "Service retrieved successfully",
      data: service,
    });
  } catch (error: any) {
    console.error("[Public Service] Error:", error?.message ?? error);
    return NextResponse.json({ status: 500, message: "Internal server error" }, { status: 500 });
  }
}
