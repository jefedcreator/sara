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
import { GET, PUT } from "./route";

const mockedDb = db as any;
const mockedOrders = orderService as any;
const BUSINESS = { id: "biz_1", ownerId: "user_1" };
const USER = { id: "user_1", name: "Owner", email: "owner@example.com" };
const SLUG = "tobi-hair-abc";
const ORDER = {
  id: "ord_1",
  slug: SLUG,
  publicId: "ord_pub",
  orderNumber: "ORD-1022",
  status: "NEW",
  fulfilment: "DELIVERY",
  total: "93000",
  lines: [],
  customer: null,
  invoice: null,
  receipt: null,
};

function params() {
  return { params: Promise.resolve({ slug: SLUG }) };
}

function request(method: "GET" | "PUT", body?: unknown) {
  return createMockRequest({
    method,
    url: `http://localhost:3000/api/orders/${SLUG}`,
    cookies: authenticatedCookies(),
    headers: body ? { "content-type": "application/json" } : {},
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedOrders.getBySlug.mockResolvedValue(ORDER);
  mockedOrders.setStatus.mockResolvedValue({ ...ORDER, status: "READY" });
  mockedOrders.setFulfilment.mockResolvedValue({
    ...ORDER,
    fulfilment: "PICKUP",
    deliveryAddress: null,
  });
});

describe("GET /api/orders/[slug]", () => {
  it("needs a session", async () => {
    const response = await GET(
      createMockRequest({ url: `http://localhost:3000/api/orders/${SLUG}` }),
      params(),
    );

    expect(response.status).toBe(401);
  });

  it("returns one order in the response envelope", async () => {
    mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });

    const response = await GET(request("GET"), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: 200,
      message: "Order retrieved successfully",
      data: { orderNumber: "ORD-1022", status: "NEW" },
    });
    expect(mockedOrders.getBySlug).toHaveBeenCalledWith("biz_1", SLUG);
  });
});

describe("PUT /api/orders/[slug]", () => {
  it("needs a session", async () => {
    const response = await PUT(
      createMockRequest({
        method: "PUT",
        url: `http://localhost:3000/api/orders/${SLUG}`,
        headers: { "content-type": "application/json" },
        body: { status: "READY" },
      }),
      params(),
    );

    expect(response.status).toBe(401);
    expect(mockedOrders.setStatus).not.toHaveBeenCalled();
  });

  it("moves the order's status", async () => {
    mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });

    const response = await PUT(request("PUT", { status: "READY" }), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("READY");
    expect(mockedOrders.setStatus).toHaveBeenCalledWith(
      "biz_1",
      SLUG,
      "READY",
    );
    expect(mockedOrders.setFulfilment).not.toHaveBeenCalled();
  });

  it("switches the order's fulfilment", async () => {
    mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });

    const response = await PUT(
      request("PUT", { fulfilment: "PICKUP" }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(mockedOrders.setFulfilment).toHaveBeenCalledWith("biz_1", SLUG, {
      fulfilment: "PICKUP",
    });
    expect(mockedOrders.setStatus).not.toHaveBeenCalled();
  });

  it("rejects a body with both a status and a fulfilment", async () => {
    mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });

    const response = await PUT(
      request("PUT", { status: "READY", fulfilment: "PICKUP" }),
      params(),
    );

    expect(response.status).toBe(422);
    expect(mockedOrders.setStatus).not.toHaveBeenCalled();
    expect(mockedOrders.setFulfilment).not.toHaveBeenCalled();
  });
});
