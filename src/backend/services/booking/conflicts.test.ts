import { describe, expect, it } from "vitest";

import { activeBookingWhere, blockingBookingsWhere, holdExpiresFrom } from "./conflicts";

const NOW = new Date("2026-10-01T09:00:00.000Z");
const RANGE = { start: new Date("2026-10-02T14:00:00.000Z"), end: new Date("2026-10-05T12:00:00.000Z") };

describe("activeBookingWhere", () => {
  it("counts confirmed bookings and unpaid ones whose hold is still live", () => {
    expect(activeBookingWhere(NOW)).toEqual({
      OR: [
        { status: "CONFIRMED" },
        { status: "PENDING", OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: NOW } }] },
      ],
    });
  });
});

describe("holdExpiresFrom", () => {
  it("holds for 30 minutes", () => {
    expect(holdExpiresFrom(NOW)).toEqual(new Date("2026-10-01T09:30:00.000Z"));
  });
});

describe("blockingBookingsWhere", () => {
  it("scopes a slot service to the owner's other slot bookings, business-wide", () => {
    const where = blockingBookingsWhere({ id: "svc_1", businessId: "biz_1", bookingMode: "SLOT" }, RANGE, { now: NOW });
    expect(where).toEqual({
      businessId: "biz_1",
      service: { bookingMode: "SLOT" },
      startTime: { lt: RANGE.end },
      endTime: { gt: RANGE.start },
      AND: [activeBookingWhere(NOW)],
    });
  });

  it("scopes a stay or rental to the same service only", () => {
    const where = blockingBookingsWhere({ id: "svc_4b", businessId: "biz_1", bookingMode: "NIGHTLY" }, RANGE, { now: NOW });
    expect(where).toEqual({
      serviceId: "svc_4b",
      startTime: { lt: RANGE.end },
      endTime: { gt: RANGE.start },
      AND: [activeBookingWhere(NOW)],
    });
    expect(where).not.toHaveProperty("businessId");
  });

  it("can leave out the booking being moved", () => {
    const where = blockingBookingsWhere(
      { id: "svc_car", businessId: "biz_1", bookingMode: "DAILY" },
      RANGE,
      { now: NOW, excludeId: "bkg_1" },
    );
    expect(where).toMatchObject({ serviceId: "svc_car", id: { not: "bkg_1" } });
  });
});
