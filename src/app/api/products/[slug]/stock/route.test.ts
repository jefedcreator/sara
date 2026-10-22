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

vi.mock("@/backend/services/product", () => ({
  productService: {
    create: vi.fn(),
    update: vi.fn(),
    list: vi.fn(),
    getBySlug: vi.fn(),
    adjustStock: vi.fn(),
  },
}));

vi.mock("@/backend/services/cloudinary", () => ({
  cloudinaryService: { uploadFile: vi.fn() },
}));

import { productService } from "@/backend/services/product";
import { db } from "@/server/db";
import { POST } from "./route";

const mockedDb = db as any;
const mockedProduct = productService as any;

const BUSINESS = { id: "biz_1", ownerId: "user_1" };
const USER = { id: "user_1", name: "Owner", email: "owner@example.com" };
const SLUG = "frontal-wig";
const OPTION = {
  id: "opt_1",
  productId: "prd_1",
  name: '20"',
  price: null,
  stock: 11,
  position: 0,
  isActive: true,
};

function params() {
  return { params: Promise.resolve({ slug: SLUG }) };
}

function request(body: unknown) {
  return createMockRequest({
    method: "POST",
    url: `http://localhost:3000/api/products/${SLUG}/stock`,
    cookies: authenticatedCookies(),
    headers: { "content-type": "application/json" },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });
  mockedProduct.adjustStock.mockResolvedValue(OPTION);
});

describe("POST /api/products/[slug]/stock", () => {
  it("returns the updated option", async () => {
    const response = await POST(request({ optionId: "opt_1", add: 5 }), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: 200,
      message: "Stock updated successfully",
      data: { id: "opt_1", stock: 11 },
    });
    expect(mockedProduct.adjustStock).toHaveBeenCalledWith(
      BUSINESS.id,
      "opt_1",
      { add: 5 },
    );
  });

  it("passes an exact set through", async () => {
    await POST(request({ optionId: "opt_1", set: 2 }), params());

    expect(mockedProduct.adjustStock).toHaveBeenCalledWith(
      BUSINESS.id,
      "opt_1",
      { set: 2 },
    );
  });

  it("rejects both add and set before calling the service", async () => {
    const response = await POST(
      request({ optionId: "opt_1", add: 1, set: 2 }),
      params(),
    );

    expect(response.status).toBe(422);
    expect(mockedProduct.adjustStock).not.toHaveBeenCalled();
  });

  it("needs a session", async () => {
    const response = await POST(
      createMockRequest({
        method: "POST",
        url: `http://localhost:3000/api/products/${SLUG}/stock`,
      }),
      params(),
    );

    expect(response.status).toBe(401);
  });
});
