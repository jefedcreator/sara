import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticatedCookies,
  createMockRequest,
  mockAuthenticatedSession,
} from "@/backend/test-utils/mock-request";

vi.mock("@/server/db", () => {
  const db: any = {
    session: { findUnique: vi.fn(), delete: vi.fn() },
    service: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    booking: { count: vi.fn() },
  };
  db.$transaction = vi.fn(async (work: any) => work(db));
  return { db };
});
vi.mock("@/backend/services/cloudinary", () => ({ cloudinaryService: { uploadFile: vi.fn() } }));

vi.mock("@/backend/services/availability", () => ({
  availabilityService: { getAvailableSlots: vi.fn() },
}));

import { availabilityService } from "@/backend/services/availability";
import { db } from "@/server/db";
import { cloudinaryService } from "@/backend/services/cloudinary";
import { GET, PUT } from "./route";

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


describe("PUT /api/services/[slug]", () => {
  const service = { ...SERVICE, name: "Haircut", price: 10000, bookingMode: "SLOT", minUnits: 1, maxUnits: 30,
    checkInTime: null, checkOutTime: null, business: { ownerId: USER.id, name: "Salon" } };

  beforeEach(() => {
    mockedDb.service.findFirst.mockImplementation(async ({ where }: any) => where.slug ? service : null);
    mockedDb.service.update.mockImplementation(async ({ data }: any) => ({ ...service, ...data }));
    mockedDb.booking.count.mockResolvedValue(0);
  });

  it("pauses through the shared mutation and preserves the response envelope", async () => {
    const response = await PUT(createMockRequest({
      method: "PUT", cookies: authenticatedCookies(), headers: { "content-type": "application/json" }, body: { isActive: false },
    }), { params: Promise.resolve({ slug: SERVICE.slug }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ status: 200, message: "Service updated successfully", data: expect.objectContaining({ isActive: false }) }));
    expect(mockedDb.service.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { businessId: BUSINESS.id, slug: SERVICE.slug } }));
  });

  it("uploads before entering the transaction and persists the separate URL", async () => {
    const form = new FormData();
    form.set("image", new File(["photo"], "photo.png", { type: "image/png" }));
    const request = createMockRequest({ method: "PUT", cookies: authenticatedCookies(), headers: { "content-type": "multipart/form-data" } });
    request.formData = async () => form;
    vi.mocked(cloudinaryService.uploadFile).mockImplementationOnce(async () => {
      expect(mockedDb.$transaction).not.toHaveBeenCalled();
      return { secure_url: "https://images.example/new.png" } as never;
    });
    const response = await PUT(request, { params: Promise.resolve({ slug: SERVICE.slug }) });
    expect(response.status).toBe(200);
    expect(mockedDb.service.update).toHaveBeenCalledWith({ where: { id: SERVICE.id }, data: expect.objectContaining({ image: "https://images.example/new.png" }) });
    expect(cloudinaryService.uploadFile).toHaveBeenCalledOnce();
  });

  it("refuses booking-mode changes while upcoming bookings exist", async () => {
    mockedDb.booking.count.mockResolvedValueOnce(1);
    const response = await PUT(createMockRequest({
      method: "PUT", cookies: authenticatedCookies(), headers: { "content-type": "application/json" }, body: { bookingMode: "DAILY" },
    }), { params: Promise.resolve({ slug: SERVICE.slug }) });
    expect(response.status).toBe(400);
    expect(mockedDb.service.update).not.toHaveBeenCalled();
  });
});
