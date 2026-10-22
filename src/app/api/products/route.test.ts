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

import { cloudinaryService } from "@/backend/services/cloudinary";
import { productService } from "@/backend/services/product";
import { db } from "@/server/db";
import { GET, POST } from "./route";

const mockedDb = db as any;
const mockedProduct = productService as any;
const mockedCloudinary = cloudinaryService as any;

const BUSINESS = { id: "biz_1", ownerId: "user_1" };
const USER = { id: "user_1", name: "Owner", email: "owner@example.com" };
const PRODUCT = {
  id: "prd_1",
  slug: "frontal-wig",
  businessId: BUSINESS.id,
  name: "Frontal wig",
  description: "Hand-tied frontal unit",
  price: "45000",
  photos: ["https://cdn.test/1.jpg", "https://cdn.test/2.jpg"],
  tracksStock: true,
  isActive: true,
  createdAt: "2026-10-21T12:00:00.000Z",
  updatedAt: "2026-10-21T12:00:00.000Z",
  options: [
    {
      id: "opt_1",
      productId: "prd_1",
      name: '20"',
      price: null,
      stock: 6,
      position: 0,
      isActive: true,
    },
  ],
};

function buildForm() {
  const form = new FormData();
  form.set("name", "Frontal wig");
  form.set("description", "Hand-tied frontal unit");
  form.set("price", "45000");
  form.set("tracksStock", "true");
  form.set("options", JSON.stringify([{ name: '20"', stock: 6 }]));
  return form;
}

function multipartRequest(form: FormData) {
  const request = createMockRequest({
    method: "POST",
    url: "http://localhost:3000/api/products",
    cookies: authenticatedCookies(),
    headers: { "content-type": "multipart/form-data; boundary=test" },
  });
  request.formData = async () => form;
  return request;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });
  mockedProduct.list.mockResolvedValue([PRODUCT]);
});

describe("POST /api/products", () => {
  it("uploads each photo and creates the product with both URLs", async () => {
    const form = buildForm();
    const first = new File(["one"], "one.jpg", { type: "image/jpeg" });
    const second = new File(["two"], "two.jpg", { type: "image/jpeg" });
    form.append("photos", first);
    form.append("photos", second);

    mockedCloudinary.uploadFile
      .mockResolvedValueOnce({ secure_url: "https://cdn.test/1.jpg" })
      .mockResolvedValueOnce({ secure_url: "https://cdn.test/2.jpg" });
    mockedProduct.create.mockResolvedValue(PRODUCT);

    const response = await POST(multipartRequest(form), {
      params: Promise.resolve({}),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.status).toBe(201);
    expect(body.data).toMatchObject({ slug: "frontal-wig", options: [{ name: '20"' }] });
    expect(mockedCloudinary.uploadFile).toHaveBeenCalledTimes(2);
    expect(mockedCloudinary.uploadFile).toHaveBeenNthCalledWith(1, first, {
      folder: `sara/${BUSINESS.id}/products`,
    });
    expect(mockedCloudinary.uploadFile).toHaveBeenNthCalledWith(2, second, {
      folder: `sara/${BUSINESS.id}/products`,
    });
    expect(mockedProduct.create).toHaveBeenCalledWith(
      BUSINESS.id,
      expect.objectContaining({
        name: "Frontal wig",
        description: "Hand-tied frontal unit",
        price: 45000,
        tracksStock: true,
        options: [{ name: '20"', stock: 6 }],
      }),
      ["https://cdn.test/1.jpg", "https://cdn.test/2.jpg"],
    );
  });

  it("needs a session", async () => {
    const response = await POST(
      createMockRequest({
        method: "POST",
        url: "http://localhost:3000/api/products",
      }),
      { params: Promise.resolve({}) },
    );

    expect(response.status).toBe(401);
    expect(mockedProduct.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/products", () => {
  it("returns the products in the response envelope", async () => {
    const response = await GET(
      createMockRequest({
        url: "http://localhost:3000/api/products",
        cookies: authenticatedCookies(),
      }),
      { params: Promise.resolve({}) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: 200,
      message: "Products retrieved successfully",
      data: [{ slug: "frontal-wig" }],
    });
    expect(mockedProduct.list).toHaveBeenCalledWith(BUSINESS.id, {
      includeInactive: false,
    });
  });

  it("passes includeInactive through", async () => {
    await GET(
      createMockRequest({
        url: "http://localhost:3000/api/products?includeInactive=true",
        cookies: authenticatedCookies(),
      }),
      { params: Promise.resolve({}) },
    );

    expect(mockedProduct.list).toHaveBeenCalledWith(BUSINESS.id, {
      includeInactive: true,
    });
  });

  it("needs a session", async () => {
    const response = await GET(
      createMockRequest({ url: "http://localhost:3000/api/products" }),
      { params: Promise.resolve({}) },
    );

    expect(response.status).toBe(401);
  });
});
