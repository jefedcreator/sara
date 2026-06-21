import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => {
  const db: any = { service: { findFirst: vi.fn() } };
  return { db };
});
vi.mock("@/backend/services/availability", () => ({
  availabilityService: { getAvailableSlots: vi.fn() },
}));

import { availabilityService } from "@/backend/services/availability";
import { db } from "@/server/db";
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
});
