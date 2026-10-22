import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticatedCookies,
  createMockRequest,
  mockAuthenticatedSession,
} from "@/backend/test-utils/mock-request";

vi.mock("@/server/db", () => ({
  db: {
    session: { findUnique: vi.fn(), delete: vi.fn() },
    customer: { findFirst: vi.fn(), update: vi.fn() },
    booking: { findMany: vi.fn() },
    invoice: { aggregate: vi.fn(), findMany: vi.fn() },
    receipt: { aggregate: vi.fn(), findMany: vi.fn() },
    payment: { aggregate: vi.fn() },
    order: { findMany: vi.fn() },
  },
}));

import { db } from "@/server/db";
import { GET, PUT } from "./route";

const mockedDb = db as any;
const BUSINESS = { id: "biz_1", ownerId: "user_1" };
const USER = { id: "user_1", name: "Owner", email: "owner@example.com" };
const CUSTOMER_ID = "cmcustomer000000000000001";

function customer(overrides: Record<string, unknown> = {}) {
  return {
    id: CUSTOMER_ID,
    businessId: BUSINESS.id,
    name: "Tolu Adeyemi",
    nameKey: "tolu adeyemi",
    phone: "+2348035550142",
    email: "tolu@example.com",
    address: "12 Admiralty Way",
    notes: null,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    ...overrides,
  };
}

function request(method: "GET" | "PUT", body?: unknown) {
  return createMockRequest({
    method,
    url: `http://localhost:3000/api/customers/${CUSTOMER_ID}`,
    cookies: authenticatedCookies(),
    headers: body ? { "content-type": "application/json" } : {},
    body,
  });
}

function params() {
  return { params: Promise.resolve({ id: CUSTOMER_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.customer.findFirst.mockResolvedValue(customer());
  mockedDb.payment.aggregate.mockResolvedValue({
    _sum: { amount: 15000 },
    _max: { createdAt: new Date("2026-10-05T00:00:00.000Z") },
  });
  mockedDb.receipt.aggregate.mockResolvedValue({ _sum: { amountPaid: 5000 } });
  mockedDb.invoice.aggregate.mockResolvedValue({
    _sum: { total: 50000, amountPaid: 10000 },
  });
  mockedDb.booking.findMany.mockResolvedValue([]);
  mockedDb.invoice.findMany.mockResolvedValue([]);
  mockedDb.receipt.findMany.mockResolvedValue([]);
  mockedDb.order.findMany.mockResolvedValue([]);
  mockedDb.customer.update.mockImplementation(async ({ data }: any) => ({
    ...customer(),
    ...data,
  }));
});

describe("GET /api/customers/[id]", () => {
  it("needs a session", async () => {
    const response = await GET(
      createMockRequest({
        url: `http://localhost:3000/api/customers/${CUSTOMER_ID}`,
      }),
      params(),
    );

    expect(response.status).toBe(401);
  });

  it("returns the customer's figures and timeline", async () => {
    mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });
    mockedDb.invoice.findMany.mockResolvedValue([
      {
        id: "inv_1",
        publicId: "inv_public",
        invoiceNumber: "INV-1042",
        status: "SENT",
        total: 50000,
        createdAt: new Date("2026-10-04T00:00:00.000Z"),
      },
    ]);

    const response = await GET(request("GET"), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      id: CUSTOMER_ID,
      name: "Tolu Adeyemi",
      spent: 20000,
      owes: 40000,
      lastActivityAt: "2026-10-05T00:00:00.000Z",
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    expect(body.data.timeline[0]).toMatchObject({
      kind: "invoice",
      label: "Invoice INV-1042",
      href: "/invoices/inv_public",
    });
  });

  it("returns 404 for a customer of another business", async () => {
    mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });
    mockedDb.customer.findFirst.mockResolvedValue(null);

    const response = await GET(request("GET"), params());

    expect(response.status).toBe(404);
  });
});

describe("PUT /api/customers/[id]", () => {
  it("needs a session", async () => {
    const response = await PUT(
      createMockRequest({
        method: "PUT",
        url: `http://localhost:3000/api/customers/${CUSTOMER_ID}`,
        headers: { "content-type": "application/json" },
        body: { name: "Tolu A." },
      }),
      params(),
    );

    expect(response.status).toBe(401);
  });

  it("updates the customer's details", async () => {
    mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });

    const response = await PUT(request("PUT", { name: "Tolu A." }), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.name).toBe("Tolu A.");
    expect(mockedDb.customer.update).toHaveBeenCalledWith({
      where: { id: CUSTOMER_ID },
      data: { name: "Tolu A.", nameKey: "tolu a." },
    });
  });

  it("rejects a phone another customer already has", async () => {
    mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });
    mockedDb.customer.update.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: { target: ["businessId", "phone"] },
      }),
    );

    const response = await PUT(
      request("PUT", { phone: "0803 555 0142" }),
      params(),
    );

    expect(response.status).toBe(409);
  });
});
