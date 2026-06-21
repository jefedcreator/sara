import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticatedCookies,
  createMockRequest,
  mockAuthenticatedSession,
} from "@/backend/test-utils/mock-request";

vi.mock("@/server/db", () => ({
  db: {
    session: { findUnique: vi.fn(), delete: vi.fn() },
    businessClosure: { findUnique: vi.fn(), delete: vi.fn() },
  },
}));

import { db } from "@/server/db";
import { DELETE } from "./route";

const mockedDb = db as any;

const BUSINESS = { id: "biz_1", ownerId: "user_1" };
const OTHER_BUSINESS_ID = "biz_2";
const USER = { id: "user_1", name: "Owner", email: "owner@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });
});

describe("DELETE /api/business/closures/[id]", () => {
  it("deletes a closure owned by the caller's business", async () => {
    mockedDb.businessClosure.findUnique.mockResolvedValue({
      id: "c1",
      businessId: BUSINESS.id,
    });

    const request = createMockRequest({
      method: "DELETE",
      cookies: authenticatedCookies(),
    });
    const response = await DELETE(request, {
      params: Promise.resolve({ id: "c1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ id: "c1" });
    expect(mockedDb.businessClosure.delete).toHaveBeenCalledWith({
      where: { id: "c1" },
    });
  });

  it("returns 404 for a closure that doesn't exist", async () => {
    mockedDb.businessClosure.findUnique.mockResolvedValue(null);

    const request = createMockRequest({
      method: "DELETE",
      cookies: authenticatedCookies(),
    });
    const response = await DELETE(request, {
      params: Promise.resolve({ id: "missing" }),
    });

    expect(response.status).toBe(404);
  });

  it("returns 403 when the closure belongs to a different business", async () => {
    mockedDb.businessClosure.findUnique.mockResolvedValue({
      id: "c1",
      businessId: OTHER_BUSINESS_ID,
    });

    const request = createMockRequest({
      method: "DELETE",
      cookies: authenticatedCookies(),
    });
    const response = await DELETE(request, {
      params: Promise.resolve({ id: "c1" }),
    });

    expect(response.status).toBe(403);
    expect(mockedDb.businessClosure.delete).not.toHaveBeenCalled();
  });
});
