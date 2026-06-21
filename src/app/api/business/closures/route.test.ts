import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticatedCookies,
  createMockRequest,
  mockAuthenticatedSession,
} from "@/backend/test-utils/mock-request";

vi.mock("@/server/db", () => ({
  db: {
    session: { findUnique: vi.fn(), delete: vi.fn() },
    businessClosure: { findMany: vi.fn(), create: vi.fn() },
  },
}));

import { db } from "@/server/db";
import { GET, POST } from "./route";

const mockedDb = db as any;

const BUSINESS = { id: "biz_1", ownerId: "user_1" };
const USER = { id: "user_1", name: "Owner", email: "owner@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });
});

describe("GET /api/business/closures", () => {
  it("lists closures for the authenticated user's business", async () => {
    const closures = [{ id: "c1", businessId: BUSINESS.id, date: new Date("2026-12-25") }];
    mockedDb.businessClosure.findMany.mockResolvedValue(closures);

    const request = createMockRequest({ cookies: authenticatedCookies() });
    const response = await GET(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(
      closures.map((c) => ({ ...c, date: c.date.toISOString() })),
    );
    expect(mockedDb.businessClosure.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: BUSINESS.id } }),
    );
  });
});

describe("POST /api/business/closures", () => {
  it("creates a closure", async () => {
    const created = {
      id: "c1",
      businessId: BUSINESS.id,
      date: new Date("2026-12-25"),
      reason: "Holiday",
    };
    mockedDb.businessClosure.create.mockResolvedValue(created);

    const request = createMockRequest({
      method: "POST",
      cookies: authenticatedCookies(),
      headers: { "content-type": "application/json" },
      body: { date: "2026-12-25", reason: "Holiday" },
    });
    const response = await POST(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data).toEqual({ ...created, date: created.date.toISOString() });
  });

  it("rejects a malformed date", async () => {
    const request = createMockRequest({
      method: "POST",
      cookies: authenticatedCookies(),
      headers: { "content-type": "application/json" },
      body: { date: "12/25/2026" },
    });
    const response = await POST(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(422);
    expect(mockedDb.businessClosure.create).not.toHaveBeenCalled();
  });

  it("returns 409 when a closure already exists for that date", async () => {
    mockedDb.businessClosure.create.mockRejectedValue({ code: "P2002" });

    const request = createMockRequest({
      method: "POST",
      cookies: authenticatedCookies(),
      headers: { "content-type": "application/json" },
      body: { date: "2026-12-25" },
    });
    const response = await POST(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(409);
  });
});
