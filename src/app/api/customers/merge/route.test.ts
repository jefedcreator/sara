import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticatedCookies,
  createMockRequest,
  mockAuthenticatedSession,
} from "@/backend/test-utils/mock-request";

vi.mock("@/server/db", () => {
  const db: any = {
    session: { findUnique: vi.fn(), delete: vi.fn() },
    customer: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    booking: { updateMany: vi.fn() },
    invoice: { updateMany: vi.fn() },
    receipt: { updateMany: vi.fn() },
    payment: { updateMany: vi.fn() },
    order: { updateMany: vi.fn() },
  };
  db.$transaction = vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db));
  return { db };
});

import { db } from "@/server/db";
import { POST } from "./route";

const mockedDb = db as any;
const BUSINESS = { id: "biz_1", ownerId: "user_1" };
const USER = { id: "user_1", name: "Owner", email: "owner@example.com" };
const KEEP_ID = "cmkeep000000000000000001";
const MERGE_ID = "cmmerge00000000000000001";

function customer(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
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

function post(body: unknown) {
  return POST(
    createMockRequest({
      method: "POST",
      url: "http://localhost:3000/api/customers/merge",
      cookies: authenticatedCookies(),
      headers: { "content-type": "application/json" },
      body,
    }),
    { params: Promise.resolve({}) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.customer.findFirst.mockReset();
  mockedDb.customer.findFirst
    .mockResolvedValueOnce(customer(KEEP_ID))
    .mockResolvedValueOnce(customer(MERGE_ID));
  mockedDb.customer.update.mockImplementation(async ({ data }: any) => ({
    ...customer(KEEP_ID),
    ...data,
  }));
  mockedDb.customer.delete.mockResolvedValue(customer(MERGE_ID));
});

describe("POST /api/customers/merge", () => {
  it("needs a session", async () => {
    const response = await POST(
      createMockRequest({
        method: "POST",
        url: "http://localhost:3000/api/customers/merge",
        headers: { "content-type": "application/json" },
        body: { keepId: KEEP_ID, mergeId: MERGE_ID },
      }),
      { params: Promise.resolve({}) },
    );

    expect(response.status).toBe(401);
  });

  it("moves the records and returns the kept customer", async () => {
    mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });

    const response = await post({ keepId: KEEP_ID, mergeId: MERGE_ID });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.id).toBe(KEEP_ID);
    for (const delegate of [
      mockedDb.booking,
      mockedDb.invoice,
      mockedDb.receipt,
      mockedDb.payment,
      mockedDb.order,
    ]) {
      expect(delegate.updateMany).toHaveBeenCalledWith({
        where: { customerId: MERGE_ID },
        data: { customerId: KEEP_ID },
      });
    }
    expect(mockedDb.customer.delete).toHaveBeenCalledWith({
      where: { id: MERGE_ID },
    });
  });

  it("refuses to merge a customer with itself", async () => {
    mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });

    const response = await post({ keepId: KEEP_ID, mergeId: KEEP_ID });

    expect(response.status).toBe(400);
    expect(mockedDb.customer.delete).not.toHaveBeenCalled();
  });

  it("returns 404 for a customer of another business", async () => {
    mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });
    mockedDb.customer.findFirst
      .mockReset()
      .mockResolvedValueOnce(customer(KEEP_ID))
      .mockResolvedValueOnce(null);

    const response = await post({ keepId: KEEP_ID, mergeId: MERGE_ID });

    expect(response.status).toBe(404);
    expect(mockedDb.customer.delete).not.toHaveBeenCalled();
  });
});
