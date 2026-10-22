import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticatedCookies,
  createMockRequest,
  mockAuthenticatedSession,
} from "@/backend/test-utils/mock-request";

vi.mock("@/server/db", () => ({
  db: {
    session: { findUnique: vi.fn(), delete: vi.fn() },
  },
}));

vi.mock("@/backend/services/order", () => ({
  orderService: {
    list: vi.fn(),
    getBySlug: vi.fn(),
    setStatus: vi.fn(),
    setFulfilment: vi.fn(),
  },
}));

import { orderService } from "@/backend/services/order";
import { db } from "@/server/db";
import { GET } from "./route";

const mockedDb = db as any;
const mockedOrders = orderService as any;
const BUSINESS = { id: "biz_1", ownerId: "user_1" };
const USER = { id: "user_1", name: "Owner", email: "owner@example.com" };
const ORDER = {
  id: "ord_1",
  slug: "tobi-hair-abc",
  publicId: "ord_pub",
  orderNumber: "ORD-1022",
  status: "READY",
  fulfilment: "DELIVERY",
  total: "93000",
  lines: [],
  customer: null,
  invoice: null,
  receipt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedOrders.list.mockResolvedValue({ data: [ORDER], total: 1 });
});

describe("GET /api/orders", () => {
  it("needs a session", async () => {
    const response = await GET(
      createMockRequest({ url: "http://localhost:3000/api/orders" }),
      { params: Promise.resolve({}) },
    );

    expect(response.status).toBe(401);
  });

  it("returns a paginated list with the requested status", async () => {
    mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });

    const response = await GET(
      createMockRequest({
        url: "http://localhost:3000/api/orders?status=READY&page=2&size=10",
        cookies: authenticatedCookies(),
      }),
      { params: Promise.resolve({}) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: 200,
      message: "Orders retrieved successfully",
      total: 1,
      page: 2,
      size: 10,
      totalPages: 1,
    });
    expect(body.data[0]).toMatchObject({
      orderNumber: "ORD-1022",
      status: "READY",
    });
    expect(mockedOrders.list).toHaveBeenCalledWith("biz_1", {
      status: "READY",
      page: 2,
      size: 10,
    });
  });

  it("rejects a status outside the owner's list", async () => {
    mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });

    const response = await GET(
      createMockRequest({
        url: "http://localhost:3000/api/orders?status=AWAITING_PAYMENT",
        cookies: authenticatedCookies(),
      }),
      { params: Promise.resolve({}) },
    );

    expect(response.status).toBe(422);
    expect(mockedOrders.list).not.toHaveBeenCalled();
  });
});
