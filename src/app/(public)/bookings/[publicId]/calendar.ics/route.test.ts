import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://app.sara.ng" } }));
vi.mock("@/server", () => ({ getPublicBooking: vi.fn() }));

import { getPublicBooking } from "@/server";

import { GET } from "./route";

const mockedGet = getPublicBooking as any;

const UPCOMING = {
  publicId: "Pq8sN1xV0kL3mA6t",
  status: "CONFIRMED",
  startTime: "2099-10-12T14:00:00.000Z",
  endTime: "2099-10-12T18:00:00.000Z",
  units: 1,
  holdExpiresAt: null,
  amount: 25000,
  currency: "NGN",
  clientName: "Ada Okafor",
  service: { slug: "acme-knotless-braids", name: "Knotless braids", bookingMode: "SLOT" },
  businessName: "Acme Salon",
  businessAddress: null,
  receiptPath: null,
};

const call = (publicId = "Pq8sN1xV0kL3mA6t") =>
  GET(new Request(`https://app.sara.ng/bookings/${publicId}/calendar.ics`), {
    params: Promise.resolve({ publicId }),
  });

beforeEach(() => vi.clearAllMocks());

describe("GET /bookings/[publicId]/calendar.ics", () => {
  it("downloads the event for a booking still to come", async () => {
    mockedGet.mockResolvedValue(UPCOMING);
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="booking.ics"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(body).toContain("DTSTART:20991012T140000");
    expect(body).toContain("URL:https://app.sara.ng/bookings/Pq8sN1xV0kL3mA6t");
  });

  it("answers 404 for an unknown, cancelled or past booking", async () => {
    mockedGet.mockResolvedValue(null);
    expect((await call("nope")).status).toBe(404);
    mockedGet.mockResolvedValue({ ...UPCOMING, status: "CANCELLED" });
    expect((await call()).status).toBe(404);
    mockedGet.mockResolvedValue({ ...UPCOMING, startTime: "2020-01-01T10:00:00.000Z" });
    expect((await call()).status).toBe(404);
  });
});
