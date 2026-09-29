import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticatedCookies,
  createMockRequest,
  mockAuthenticatedSession,
} from "@/backend/test-utils/mock-request";

vi.mock("@/server/db", () => ({
  db: {
    session: { findUnique: vi.fn(), delete: vi.fn() },
    payment: { aggregate: vi.fn() },
    invoice: { count: vi.fn(), aggregate: vi.fn(), findMany: vi.fn() },
    booking: { findMany: vi.fn() },
  },
}));

import { db } from "@/server/db";
import { GET } from "./route";

const mockedDb = db as any;
const BUSINESS = { id: "biz_1", ownerId: "user_1", currency: "NGN" };
const USER = { id: "user_1", name: "Owner", email: "owner@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });
});

describe("GET /api/dashboard", () => {
  it("returns the summary, today's bookings, unpaid invoices and revenue", async () => {
    mockedDb.payment.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 25000 } })
      .mockResolvedValueOnce({ _sum: { amount: 70000 } });
    mockedDb.invoice.count.mockResolvedValue(2);
    mockedDb.invoice.aggregate.mockResolvedValue({
      _sum: { total: 50000, amountPaid: 10000 },
    });
    const start = new Date("2026-09-29T13:00:00.000Z");
    mockedDb.booking.findMany
      // today's bookings
      .mockResolvedValueOnce([
        {
          slug: "b-1",
          startTime: start,
          endTime: new Date("2026-09-29T17:00:00.000Z"),
          status: "CONFIRMED",
          clientName: "Funke Bello",
          service: { name: "Knotless braids" },
        },
      ])
      // confirmed bookings for revenue
      .mockResolvedValueOnce([
        { serviceId: "s1", service: { name: "Knotless braids", slug: "kb", price: 25000 } },
        { serviceId: "s1", service: { name: "Knotless braids", slug: "kb", price: 25000 } },
      ]);
    mockedDb.invoice.findMany.mockResolvedValue([
      {
        slug: "inv-1",
        invoiceNumber: "INV-1001",
        clientName: "Ada",
        total: 30000,
        amountPaid: 10000,
        currency: "NGN",
        url: null,
      },
    ]);

    const request = createMockRequest({
      url: "http://localhost:3000/api/dashboard",
      cookies: authenticatedCookies(),
    });
    const response = await GET(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.summary).toEqual({
      todayRevenue: 25000,
      weekRevenue: 70000,
      unpaidCount: 2,
      unpaidTotal: 40000,
    });
    expect(body.data.todayBookings[0]).toMatchObject({
      clientName: "Funke Bello",
      serviceName: "Knotless braids",
      startTime: start.toISOString(),
    });
    expect(body.data.unpaidInvoices[0].outstanding).toBe(20000);
    expect(body.data.revenueByService[0]).toMatchObject({
      serviceName: "Knotless braids",
      totalRevenue: 50000,
      totalBookings: 2,
    });
  });

  it("refuses a signed-out request", async () => {
    const request = createMockRequest({ url: "http://localhost:3000/api/dashboard" });
    const response = await GET(request, { params: Promise.resolve({}) });
    expect(response.status).toBe(401);
  });
});
