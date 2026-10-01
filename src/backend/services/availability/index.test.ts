import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@/utils/exceptions";

vi.mock("@/server/db", () => ({
  db: {
    service: { findUnique: vi.fn() },
    businessHours: { findUnique: vi.fn() },
    businessClosure: { findUnique: vi.fn() },
    booking: { findMany: vi.fn() },
    business: { findUnique: vi.fn() },
  },
}));

vi.mock("@/backend/services/googleCalendar", () => ({
  googleCalendarService: { getBusyIntervals: vi.fn().mockResolvedValue([]) },
}));

import { googleCalendarService } from "@/backend/services/googleCalendar";
import { db } from "@/server/db";
import { availabilityService } from "./index";

type MockedDb = {
  service: { findUnique: ReturnType<typeof vi.fn> };
  businessHours: { findUnique: ReturnType<typeof vi.fn> };
  businessClosure: { findUnique: ReturnType<typeof vi.fn> };
  booking: { findMany: ReturnType<typeof vi.fn> };
  business: { findUnique: ReturnType<typeof vi.fn> };
};

const mockedDb = db as unknown as MockedDb;
const mockedCalendar = googleCalendarService as unknown as {
  getBusyIntervals: ReturnType<typeof vi.fn>;
};

const BUSINESS_ID = "biz_1";
const SERVICE_ID = "svc_1";
const DATE = "2026-06-22";

const at = (time: string) => new Date(`${DATE}T${time}:00.000Z`);

const NO_CALENDAR_BUSINESS = {
  id: BUSINESS_ID,
  googleCalendarId: null,
  googleCalendarAccessToken: null,
  googleCalendarRefreshToken: null,
  googleCalendarTokenExpiry: null,
};

function setup({
  service = { id: SERVICE_ID, businessId: BUSINESS_ID, bookingMode: "SLOT", duration: 60, availableFrom: "09:00", availableTo: "12:00" },
  businessHours = null,
  closure = null,
  bookings = [] as { startTime: Date; endTime: Date }[],
  business = NO_CALENDAR_BUSINESS,
}: {
  service?: { id?: string; businessId?: string; bookingMode?: string; duration: number; availableFrom: string; availableTo: string };
  businessHours?: {
    isClosed: boolean;
    startTime: string;
    endTime: string;
  } | null;
  closure?: unknown;
  bookings?: { startTime: Date; endTime: Date }[];
  business?: typeof NO_CALENDAR_BUSINESS | null;
} = {}) {
  mockedDb.service.findUnique.mockResolvedValue(service);
  mockedDb.businessHours.findUnique.mockResolvedValue(businessHours);
  mockedDb.businessClosure.findUnique.mockResolvedValue(closure);
  mockedDb.booking.findMany.mockResolvedValue(bookings);
  mockedDb.business.findUnique.mockResolvedValue(business);
}

describe("availabilityService.getAvailableSlots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCalendar.getBusyIntervals.mockResolvedValue([]);
  });

  it("throws NotFoundException when the service doesn't exist", async () => {
    mockedDb.service.findUnique.mockResolvedValue(null);

    await expect(
      availabilityService.getAvailableSlots({
        businessId: BUSINESS_ID,
        serviceId: SERVICE_ID,
        date: DATE,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it("treats every slot as within hours when no BusinessHours row exists (legacy default)", async () => {
    setup();

    const slots = await availabilityService.getAvailableSlots({
      businessId: BUSINESS_ID,
      serviceId: SERVICE_ID,
      date: DATE,
    });

    expect(slots).toHaveLength(3); // 09-10, 10-11, 11-12
    expect(slots.every((s) => s.isAvailable)).toBe(true);
  });

  it("marks every slot unavailable when BusinessHours.isClosed is true", async () => {
    setup({
      businessHours: { isClosed: true, startTime: "09:00", endTime: "17:00" },
    });

    const slots = await availabilityService.getAvailableSlots({
      businessId: BUSINESS_ID,
      serviceId: SERVICE_ID,
      date: DATE,
    });

    expect(slots.every((s) => !s.isAvailable)).toBe(true);
  });

  it("excludes slots outside business hours even when inside the service's own window", async () => {
    setup({
      service: { duration: 60, availableFrom: "08:00", availableTo: "18:00" },
      businessHours: {
        isClosed: false,
        startTime: "09:00",
        endTime: "17:00",
      },
    });

    const slots = await availabilityService.getAvailableSlots({
      businessId: BUSINESS_ID,
      serviceId: SERVICE_ID,
      date: DATE,
    });

    const eightToNine = slots.find(
      (s) => s.startTime.getTime() === at("08:00").getTime(),
    );
    const nineToTen = slots.find(
      (s) => s.startTime.getTime() === at("09:00").getTime(),
    );
    const fourToFive = slots.find(
      (s) => s.startTime.getTime() === at("16:00").getTime(),
    );
    const fiveToSix = slots.find(
      (s) => s.startTime.getTime() === at("17:00").getTime(),
    );

    expect(eightToNine?.isAvailable).toBe(false); // before business hours
    expect(nineToTen?.isAvailable).toBe(true);
    expect(fourToFive?.isAvailable).toBe(true);
    expect(fiveToSix?.isAvailable).toBe(false); // at/after business close
  });

  it("marks every slot unavailable on a closure date, regardless of hours", async () => {
    setup({
      businessHours: {
        isClosed: false,
        startTime: "00:00",
        endTime: "23:59",
      },
      closure: { id: "closure_1", businessId: BUSINESS_ID, date: at("00:00") },
    });

    const slots = await availabilityService.getAvailableSlots({
      businessId: BUSINESS_ID,
      serviceId: SERVICE_ID,
      date: DATE,
    });

    expect(slots.every((s) => !s.isAvailable)).toBe(true);
  });

  it("excludes a slot that overlaps an existing booking on a DIFFERENT service of the same business (the bug fix)", async () => {
    // The booking below has no serviceId in its select shape at all — bookings
    // are fetched scoped by businessId only, so a booking that in reality
    // belongs to a different service still excludes the overlapping slot.
    setup({
      bookings: [{ startTime: at("10:00"), endTime: at("11:00") }],
    });

    const slots = await availabilityService.getAvailableSlots({
      businessId: BUSINESS_ID,
      serviceId: SERVICE_ID,
      date: DATE,
    });

    const nineToTen = slots.find(
      (s) => s.startTime.getTime() === at("09:00").getTime(),
    );
    const tenToEleven = slots.find(
      (s) => s.startTime.getTime() === at("10:00").getTime(),
    );

    expect(nineToTen?.isAvailable).toBe(true);
    expect(tenToEleven?.isAvailable).toBe(false);

    expect(mockedDb.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ businessId: BUSINESS_ID }),
      }),
    );
  });

  it("does not generate a candidate slot that would run past the service's availableTo", async () => {
    setup({
      service: { duration: 60, availableFrom: "09:00", availableTo: "10:30" },
    });

    const slots = await availabilityService.getAvailableSlots({
      businessId: BUSINESS_ID,
      serviceId: SERVICE_ID,
      date: DATE,
    });

    // 09:00-10:00 fits; a second 10:00-11:00 slot would run past 10:30 and
    // must not be generated at all.
    expect(slots).toHaveLength(1);
    expect(slots[0]!.startTime.getTime()).toBe(at("09:00").getTime());
  });

  it("never calls Calendar lookup logic when the business has no record (defensive — should not happen via the route)", async () => {
    setup({ business: null });

    const slots = await availabilityService.getAvailableSlots({
      businessId: BUSINESS_ID,
      serviceId: SERVICE_ID,
      date: DATE,
    });

    expect(slots.every((s) => s.isAvailable)).toBe(true);
    expect(mockedCalendar.getBusyIntervals).not.toHaveBeenCalled();
  });

  it("excludes a slot that overlaps a Google Calendar busy interval", async () => {
    setup();
    mockedCalendar.getBusyIntervals.mockResolvedValue([
      { start: at("10:00"), end: at("11:00") },
    ]);

    const slots = await availabilityService.getAvailableSlots({
      businessId: BUSINESS_ID,
      serviceId: SERVICE_ID,
      date: DATE,
    });

    const nineToTen = slots.find(
      (s) => s.startTime.getTime() === at("09:00").getTime(),
    );
    const tenToEleven = slots.find(
      (s) => s.startTime.getTime() === at("10:00").getTime(),
    );

    expect(nineToTen?.isAvailable).toBe(true);
    expect(tenToEleven?.isAvailable).toBe(false);
  });

});
