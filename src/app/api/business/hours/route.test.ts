import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticatedCookies,
  createMockRequest,
  mockAuthenticatedSession,
} from "@/backend/test-utils/mock-request";

vi.mock("@/server/db", () => {
  const db: any = {
    session: { findUnique: vi.fn(), delete: vi.fn() },
    businessHours: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
  };
  db.$transaction = vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db));
  return { db };
});

import { db } from "@/server/db";
import { GET, PUT } from "./route";

const mockedDb = db as any;

const BUSINESS = { id: "biz_1", ownerId: "user_1" };
const USER = { id: "user_1", name: "Owner", email: "owner@example.com" };

describe("GET /api/business/hours", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });
  });

  it("returns an empty array when no hours are configured", async () => {
    mockedDb.businessHours.findMany.mockResolvedValue([]);

    const request = createMockRequest({ cookies: authenticatedCookies() });
    const response = await GET(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(mockedDb.businessHours.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: BUSINESS.id } }),
    );
  });

  it("rejects unauthenticated requests", async () => {
    mockedDb.session.findUnique.mockResolvedValue(null);

    const request = createMockRequest();
    const response = await GET(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(401);
  });
});

describe("PUT /api/business/hours", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });
  });

  const fullWeek = Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    startTime: "09:00",
    endTime: "17:00",
    isClosed: dayOfWeek === 0,
  }));

  it("replaces the full week and returns it", async () => {
    mockedDb.businessHours.findMany.mockResolvedValue(fullWeek);

    const request = createMockRequest({
      method: "PUT",
      cookies: authenticatedCookies(),
      headers: { "content-type": "application/json" },
      body: { days: fullWeek },
    });
    const response = await PUT(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(fullWeek);
    expect(mockedDb.businessHours.deleteMany).toHaveBeenCalledWith({
      where: { businessId: BUSINESS.id },
    });
    expect(mockedDb.businessHours.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: fullWeek.map((d) => ({ ...d, businessId: BUSINESS.id })),
      }),
    );
  });

  it("rejects a payload with fewer than 7 days", async () => {
    const request = createMockRequest({
      method: "PUT",
      cookies: authenticatedCookies(),
      headers: { "content-type": "application/json" },
      body: { days: fullWeek.slice(0, 6) },
    });
    const response = await PUT(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(422);
    expect(mockedDb.businessHours.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects a payload with a duplicate dayOfWeek", async () => {
    const badWeek = fullWeek.map((d, i) => (i === 6 ? { ...d, dayOfWeek: 0 } : d));

    const request = createMockRequest({
      method: "PUT",
      cookies: authenticatedCookies(),
      headers: { "content-type": "application/json" },
      body: { days: badWeek },
    });
    const response = await PUT(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(422);
  });
});
