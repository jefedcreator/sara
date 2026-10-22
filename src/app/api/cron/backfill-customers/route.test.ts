import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockRequest } from "@/backend/test-utils/mock-request";

const { mockedEnv } = vi.hoisted(() => ({
  mockedEnv: { CRON_SECRET: "test-secret" as string | undefined },
}));

vi.mock("@/env", () => ({ env: mockedEnv }));

vi.mock("@/backend/services/customer/backfill", () => ({
  customerBackfill: {
    run: vi.fn(),
  },
}));

import { customerBackfill } from "@/backend/services/customer/backfill";

import { GET } from "./route";

const mockedBackfill = customerBackfill as any;

function requestWithAuth(secret?: string) {
  return createMockRequest({
    url: "http://localhost:3000/api/cron/backfill-customers",
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedEnv.CRON_SECRET = "test-secret";
  mockedBackfill.run.mockResolvedValue({
    bookings: 2,
    invoices: 1,
    receipts: 1,
    payments: 3,
  });
});

describe("GET /api/cron/backfill-customers", () => {
  it("returns 401 without the cron secret", async () => {
    const response = await GET(requestWithAuth(), {
      params: Promise.resolve({}),
    });

    expect(response.status).toBe(401);
    expect(mockedBackfill.run).not.toHaveBeenCalled();
  });

  it("rejects a wrong secret", async () => {
    const response = await GET(requestWithAuth("wrong-secret"), {
      params: Promise.resolve({}),
    });

    expect(response.status).toBe(401);
    expect(mockedBackfill.run).not.toHaveBeenCalled();
  });

  it("runs the backfill and returns its counts", async () => {
    const response = await GET(requestWithAuth("test-secret"), {
      params: Promise.resolve({}),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockedBackfill.run).toHaveBeenCalledTimes(1);
    expect(body).toEqual({
      status: 200,
      message: "Customer backfill complete",
      data: { bookings: 2, invoices: 1, receipts: 1, payments: 3 },
    });
  });

  it("returns 500 when CRON_SECRET is not configured", async () => {
    mockedEnv.CRON_SECRET = undefined;

    const response = await GET(requestWithAuth("anything"), {
      params: Promise.resolve({}),
    });

    expect(response.status).toBe(500);
    expect(mockedBackfill.run).not.toHaveBeenCalled();
  });
});
