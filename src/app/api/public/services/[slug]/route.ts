import { catalogService } from "@/backend/services/catalog";
import { HttpException } from "@/utils/exceptions";
import { daysBetween } from "@/utils/format";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_WINDOW_DAYS = 125; // a month plus the longest stay (90 nights)

const unprocessable = (message: string) =>
  NextResponse.json({ status: 422, message }, { status: 422 });

/**
 * @description Public (unauthenticated) service details + availability.
 *              SLOT: ?date. NIGHTLY: ?from&to (nights in [from, to)).
 *              DAILY: ?date&units (pickup times). Used by the booking page.
 */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const search = new URL(request.url).searchParams;
    const date = search.get("date");
    const from = search.get("from");
    const to = search.get("to");
    const unitsParam = search.get("units");

    for (const [name, value] of [["date", date], ["from", from], ["to", to]] as const) {
      if (value !== null && !DATE.test(value)) return unprocessable(`${name} must be in YYYY-MM-DD format`);
    }
    if ((from === null) !== (to === null)) return unprocessable("from and to go together");
    if (from && to) {
      const span = daysBetween(from, to);
      if (span < 1 || span > MAX_WINDOW_DAYS) {
        return unprocessable(`to must be 1 to ${MAX_WINDOW_DAYS} days after from`);
      }
    }
    let units: number | undefined;
    if (unitsParam !== null) {
      units = Number(unitsParam);
      if (!Number.isInteger(units) || units < 1 || units > 90) {
        return unprocessable("units must be a whole number from 1 to 90");
      }
    }

    const service = await catalogService.getPublicService(slug, {
      date: date ?? new Date().toISOString().split("T")[0]!,
      from: from ?? undefined,
      to: to ?? undefined,
      units,
    });
    if (!service) {
      return NextResponse.json({ status: 404, message: "Service not found" }, { status: 404 });
    }
    return NextResponse.json({ status: 200, message: "Service retrieved successfully", data: service });
  } catch (error: any) {
    if (error instanceof HttpException) {
      return NextResponse.json({ status: error.statusCode, message: error.message }, { status: error.statusCode });
    }
    console.error("[Public Service] Error:", error?.message ?? error);
    return NextResponse.json({ status: 500, message: "Internal server error" }, { status: 500 });
  }
}
