import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => {
  const db: any = { service: { findFirst: vi.fn() } };
  return { db };
});
vi.mock("@/backend/services/availability", () => ({
  availabilityService: { getAvailableSlots: vi.fn(), getNights: vi.fn(), getPickupTimes: vi.fn() },
}));

import { availabilityService } from "@/backend/services/availability";
import { db } from "@/server/db";
import { BadRequestException } from "@/utils/exceptions";
import { GET } from "./route";

const mockedDb = db as any;
const mockedAvail = availabilityService as any;
beforeEach(() => vi.clearAllMocks());

function req(date?: string) {
  const url = date
    ? `https://x/api/public/services/haircut?date=${date}`
    : "https://x/api/public/services/haircut";
  return new Request(url);
}

describe("GET /api/public/services/[slug]", () => {
  it("returns the service with availability slots", async () => {
    mockedDb.service.findFirst.mockResolvedValue({
      id: "svc_1", slug: "haircut", name: "Haircut", description: null, image: null,
      price: 5000, duration: 60, isActive: true, businessId: "biz_1",
      bookingMode: "SLOT", checkInTime: null, checkOutTime: null, minUnits: 1, maxUnits: 30,
      business: { name: "Acme", currency: "NGN" },
    });
    mockedAvail.getAvailableSlots.mockResolvedValue([
      { startTime: new Date("2026-06-22T10:00:00Z"), endTime: new Date("2026-06-22T11:00:00Z"), isAvailable: true },
    ]);
    const res = await GET(req("2026-06-22"), { params: Promise.resolve({ slug: "haircut" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.name).toBe("Haircut");
    expect(json.data.slots).toHaveLength(1);
  });

  it("returns 404 for an inactive service", async () => {
    mockedDb.service.findFirst.mockResolvedValue(null);
    const res = await GET(req(), { params: Promise.resolve({ slug: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("returns 422 for a malformed date param", async () => {
    const res = await GET(req("garbage"), { params: Promise.resolve({ slug: "haircut" }) });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.message).toBe("date must be in YYYY-MM-DD format");
    expect(mockedAvail.getAvailableSlots).not.toHaveBeenCalled();
  });
});

const STAY = {
  id: "svc_4b", slug: "lekki-4b", name: "Lekki 2-bed 4B", description: null, image: null,
  price: 85000, duration: 1440, isActive: true, businessId: "biz_1",
  bookingMode: "NIGHTLY", checkInTime: "14:00", checkOutTime: "12:00", minUnits: 1, maxUnits: 30,
  business: { name: "Lekki Stays", currency: "NGN" },
};
const CAR = { ...STAY, id: "svc_car", slug: "prado", bookingMode: "DAILY", checkInTime: null, checkOutTime: null, minUnits: 1, maxUnits: 14 };
const url = (query: string) => new Request(`https://x/api/public/services/x?${query}`);
const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

describe("GET /api/public/services/[slug] for stays and rentals", () => {
  it("returns a stay's nights for the requested window", async () => {
    mockedDb.service.findFirst.mockResolvedValue(STAY);
    mockedAvail.getNights.mockResolvedValue([{ date: "2026-10-01", isAvailable: true }]);
    const res = await GET(url("from=2026-10-01&to=2026-12-01"), params("lekki-4b"));
    expect(res.status).toBe(200);
    expect(mockedAvail.getNights).toHaveBeenCalledWith({ serviceId: "svc_4b", from: "2026-10-01", to: "2026-12-01" });
    const json = await res.json();
    expect(json.data.bookingMode).toBe("NIGHTLY");
    expect(json.data.nights).toEqual([{ date: "2026-10-01", isAvailable: true }]);
    expect(json.data.slots).toEqual([]);
  });

  it("defaults a stay to the date's month window", async () => {
    mockedDb.service.findFirst.mockResolvedValue(STAY);
    mockedAvail.getNights.mockResolvedValue([]);
    await GET(url("date=2026-10-17"), params("lekki-4b"));
    expect(mockedAvail.getNights).toHaveBeenCalledWith({ serviceId: "svc_4b", from: "2026-10-01", to: "2026-12-01" });
  });

  it("returns a car's pickup times for the date and days", async () => {
    mockedDb.service.findFirst.mockResolvedValue(CAR);
    mockedAvail.getPickupTimes.mockResolvedValue([
      { startTime: new Date("2026-10-05T10:00:00Z"), endTime: new Date("2026-10-07T10:00:00Z"), isAvailable: true },
    ]);
    const res = await GET(url("date=2026-10-05&units=2"), params("prado"));
    expect(mockedAvail.getPickupTimes).toHaveBeenCalledWith({ serviceId: "svc_car", date: "2026-10-05", units: 2 });
    expect((await res.json()).data.slots).toHaveLength(1);
  });

  it("rejects a nights window longer than 125 days", async () => {
    const res = await GET(url("from=2026-10-01&to=2027-03-01"), params("lekki-4b"));
    expect(res.status).toBe(422);
  });

  it("rejects units that aren't a whole number from 1 to 90", async () => {
    const res = await GET(url("date=2026-10-05&units=0"), params("prado"));
    expect(res.status).toBe(422);
  });

  it("returns 400 when availability rejects the request", async () => {
    mockedDb.service.findFirst.mockResolvedValue(CAR);
    mockedAvail.getPickupTimes.mockRejectedValue(new BadRequestException("Book between 1 and 14 days."));
    const res = await GET(url("date=2026-10-05&units=20"), params("prado"));
    expect(res.status).toBe(400);
  });
});
