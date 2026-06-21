import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticatedCookies,
  createMockRequest,
  mockAuthenticatedSession,
} from "@/backend/test-utils/mock-request";

vi.mock("@/server/db", () => ({
  db: {
    session: { findUnique: vi.fn(), delete: vi.fn() },
    service: { findUnique: vi.fn() },
  },
}));

vi.mock("@/backend/services/availability", () => ({
  availabilityService: { getAvailableSlots: vi.fn() },
}));

import { availabilityService } from "@/backend/services/availability";
import { db } from "@/server/db";
import { GET } from "./route";

const mockedDb = db as any;
const mockedAvailability = availabilityService as any;

const BUSINESS = { id: "biz_1", ownerId: "user_1" };
const OTHER_OWNER_BUSINESS = { id: "biz_2", ownerId: "user_2" };
const USER = { id: "user_1", name: "Owner", email: "owner@example.com" };

const SERVICE = {
  id: "svc_1",
  slug: "haircut",
  businessId: BUSINESS.id,
  duration: 60,
  availableFrom: "09:00",
  availableTo: "17:00",
  business: { ownerId: USER.id },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });
});

describe("GET /api/services/[slug]", () => {
  it("maps availabilityService's result into ServiceDetail.slots and passes through the right ids/date", async () => {
    mockedDb.service.findUnique.mockResolvedValue(SERVICE);
    mockedAvailability.getAvailableSlots.mockResolvedValue([
      {
        startTime: new Date("2026-06-22T09:00:00.000Z"),
        endTime: new Date("2026-06-22T10:00:00.000Z"),
        isAvailable: true,
      },
      {
        startTime: new Date("2026-06-22T10:00:00.000Z"),
        endTime: new Date("2026-06-22T11:00:00.000Z"),
        isAvailable: false,
      },
    ]);

    const request = createMockRequest({
      url: "http://localhost:3000/api/services/haircut?date=2026-06-22",
      cookies: authenticatedCookies(),
    });
    const response = await GET(request, {
      params: Promise.resolve({ slug: "haircut" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.slots).toEqual([
      {
        startTime: "2026-06-22T09:00:00.000Z",
        endTime: "2026-06-22T10:00:00.000Z",
        isAvailable: true,
      },
      {
        startTime: "2026-06-22T10:00:00.000Z",
        endTime: "2026-06-22T11:00:00.000Z",
        isAvailable: false,
      },
    ]);
    expect(mockedAvailability.getAvailableSlots).toHaveBeenCalledWith({
      businessId: SERVICE.businessId,
      serviceId: SERVICE.id,
      date: "2026-06-22",
    });
  });

  it("defaults to today's date when none is provided", async () => {
    mockedDb.service.findUnique.mockResolvedValue(SERVICE);
    mockedAvailability.getAvailableSlots.mockResolvedValue([]);

    const today = new Date().toISOString().split("T")[0];

    const request = createMockRequest({
      url: "http://localhost:3000/api/services/haircut",
      cookies: authenticatedCookies(),
    });
    await GET(request, { params: Promise.resolve({ slug: "haircut" }) });

    expect(mockedAvailability.getAvailableSlots).toHaveBeenCalledWith(
      expect.objectContaining({ date: today }),
    );
  });

  it("rejects a malformed date query param before calling the availability engine", async () => {
    const request = createMockRequest({
      url: "http://localhost:3000/api/services/haircut?date=06-22-2026",
      cookies: authenticatedCookies(),
    });
    const response = await GET(request, {
      params: Promise.resolve({ slug: "haircut" }),
    });

    expect(response.status).toBe(422);
    expect(mockedAvailability.getAvailableSlots).not.toHaveBeenCalled();
  });

  it("returns 403 when the service belongs to a different business owner", async () => {
    mockedDb.service.findUnique.mockResolvedValue({
      ...SERVICE,
      business: { ownerId: OTHER_OWNER_BUSINESS.ownerId },
    });

    const request = createMockRequest({
      url: "http://localhost:3000/api/services/haircut",
      cookies: authenticatedCookies(),
    });
    const response = await GET(request, {
      params: Promise.resolve({ slug: "haircut" }),
    });

    expect(response.status).toBe(403);
    expect(mockedAvailability.getAvailableSlots).not.toHaveBeenCalled();
  });
});
