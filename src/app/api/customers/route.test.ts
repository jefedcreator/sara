import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticatedCookies,
  createMockRequest,
  mockAuthenticatedSession,
} from "@/backend/test-utils/mock-request";

vi.mock("@/server/db", () => {
  const db: any = {
    session: { findUnique: vi.fn(), delete: vi.fn() },
    customer: { findMany: vi.fn() },
    booking: { groupBy: vi.fn() },
    invoice: { groupBy: vi.fn() },
    receipt: { groupBy: vi.fn() },
    payment: { groupBy: vi.fn() },
    order: { groupBy: vi.fn() },
  };
  return { db };
});

import { db } from "@/server/db";
import { GET } from "./route";

const mockedDb = db as any;
const BUSINESS = { id: "biz_1", ownerId: "user_1" };
const USER = { id: "user_1", name: "Owner", email: "owner@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.booking.groupBy.mockResolvedValue([]);
  mockedDb.invoice.groupBy.mockResolvedValue([]);
  mockedDb.receipt.groupBy.mockResolvedValue([]);
  mockedDb.payment.groupBy.mockResolvedValue([]);
  mockedDb.order.groupBy.mockResolvedValue([]);
  mockedDb.customer.findMany.mockResolvedValue([]);
});

describe("GET /api/customers", () => {
  it("needs a session", async () => {
    const response = await GET(
      createMockRequest({ url: "http://localhost:3000/api/customers" }),
      { params: Promise.resolve({}) },
    );

    expect(response.status).toBe(401);
  });

  it("returns a paginated list with spent, owes and last activity", async () => {
    mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });
    mockedDb.customer.findMany.mockResolvedValue([
      {
        id: "cus_1",
        name: "Tolu Adeyemi",
        phone: "+2348035550142",
        email: "tolu@example.com",
        createdAt: new Date("2026-10-01T00:00:00.000Z"),
      },
    ]);
    mockedDb.payment.groupBy.mockResolvedValue([
      {
        customerId: "cus_1",
        _max: { createdAt: new Date("2026-10-05T00:00:00.000Z") },
        _sum: { amount: 15000 },
      },
    ]);

    const response = await GET(
      createMockRequest({
        url: "http://localhost:3000/api/customers?query=Tolu&page=1&size=10",
        cookies: authenticatedCookies(),
      }),
      { params: Promise.resolve({}) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: 200,
      total: 1,
      page: 1,
      size: 10,
      totalPages: 1,
    });
    expect(body.data[0]).toMatchObject({
      id: "cus_1",
      name: "Tolu Adeyemi",
      spent: 15000,
      owes: 0,
      lastActivityAt: "2026-10-05T00:00:00.000Z",
    });
    expect(mockedDb.customer.findMany.mock.calls[0]![0].where.OR).toEqual(
      expect.arrayContaining([
        { name: { contains: "Tolu", mode: "insensitive" } },
        { email: { contains: "Tolu", mode: "insensitive" } },
      ]),
    );
  });
});
