import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticatedCookies,
  createMockRequest,
  mockAuthenticatedSession,
} from "@/backend/test-utils/mock-request";

vi.mock("@/server/db", () => {
  const db: any = {
    session: { findUnique: vi.fn(), delete: vi.fn() },
    service: { findUnique: vi.fn() },
    booking: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    business: { findUnique: vi.fn() },
  };
  db.$transaction = vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db));
  return { db };
});

vi.mock("@/backend/services/paystack", () => ({
  paystackService: {
    initializeTransaction: vi.fn().mockResolvedValue({
      authorization_url: "https://paystack.test/pay",
      reference: "ref_123",
    }),
  },
}));

vi.mock("@/backend/services/atlas", () => ({
  atlasService: { route: vi.fn() },
}));

import { db } from "@/server/db";
import { POST } from "./route";

const mockedDb = db as any;

const BUSINESS = {
  id: "biz_1",
  ownerId: "user_1",
  name: "Acme Salon",
  paystackSubaccountCode: "ACCT_123",
  currency: "USD",
};
const USER = { id: "user_1", name: "Owner", email: "owner@example.com" };
const SERVICE = {
  id: "cservice0000000000000001",
  name: "Haircut",
  duration: 60,
  isActive: true,
  price: 50,
  businessId: "biz_1",
  bookingMode: "SLOT",
  checkInTime: null,
  checkOutTime: null,
  minUnits: 1,
  maxUnits: 30,
  business: BUSINESS,
};

const START = new Date(Date.now() + 24 * 60 * 60 * 1000);
const END = new Date(START.getTime() + 60 * 60 * 1000);

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });
  mockedDb.service.findUnique.mockResolvedValue(SERVICE);
  mockedDb.booking.findFirst.mockResolvedValue(null);
  mockedDb.booking.findUnique.mockResolvedValue(null);
  mockedDb.booking.create.mockResolvedValue({
    id: "bkg_1",
    slug: "haircut-jane-123",
    businessId: BUSINESS.id,
    serviceId: SERVICE.id,
    startTime: START,
    endTime: END,
    status: "PENDING",
  });
  mockedDb.business.findUnique.mockResolvedValue({
    latitude: null,
    longitude: null,
  });
});

describe("POST /api/bookings overlap check", () => {
  it("scopes the overlap check by businessId, not serviceId", async () => {
    const request = createMockRequest({
      method: "POST",
      cookies: authenticatedCookies(),
      headers: { "content-type": "application/json" },
      body: {
        serviceId: SERVICE.id,
        startTime: START.toISOString(),
        endTime: END.toISOString(),
        clientName: "Jane Doe",
      },
    });

    const response = await POST(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(201);
    expect(mockedDb.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ businessId: BUSINESS.id }),
      }),
    );
    const calledWhere = mockedDb.booking.findFirst.mock.calls[0]![0].where;
    expect(calledWhere).not.toHaveProperty("serviceId");
  });

  it("rejects the booking when an overlapping booking exists on the business (any service)", async () => {
    mockedDb.booking.findFirst.mockResolvedValue({ id: "existing_bkg" });

    const request = createMockRequest({
      method: "POST",
      cookies: authenticatedCookies(),
      headers: { "content-type": "application/json" },
      body: {
        serviceId: SERVICE.id,
        startTime: START.toISOString(),
        endTime: END.toISOString(),
        clientName: "Jane Doe",
      },
    });

    const response = await POST(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(409);
    expect(mockedDb.booking.create).not.toHaveBeenCalled();
  });
});
