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
import { GET, PUT } from "./route";

const mockedDb = db as any;
const mockedProduct = productService as any;
const mockedCloudinary = cloudinaryService as any;

const BUSINESS = { id: "biz_1", ownerId: "user_1" };
const USER = { id: "user_1", name: "Owner", email: "owner@example.com" };
const SLUG = "frontal-wig";
const PRODUCT = {
  id: "prd_1",
  slug: SLUG,
  businessId: BUSINESS.id,
  name: "Frontal wig",
  description: "Hand-tied frontal unit",
  price: "45000",
  photos: ["https://cdn.test/old-1.jpg", "https://cdn.test/old-2.jpg"],
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

function params() {
  return { params: Promise.resolve({ slug: SLUG }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });
  mockedProduct.getBySlug.mockResolvedValue(PRODUCT);
  mockedProduct.update.mockResolvedValue(PRODUCT);
});

describe("GET /api/products/[slug]", () => {
  it("returns one product in the response envelope", async () => {
    const response = await GET(
      createMockRequest({
        url: `http://localhost:3000/api/products/${SLUG}`,
        cookies: authenticatedCookies(),
      }),
      params(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: 200,
      data: { slug: SLUG, price: "45000" },
    });
    expect(mockedProduct.getBySlug).toHaveBeenCalledWith(BUSINESS.id, SLUG);
  });

  it("needs a session", async () => {
    const response = await GET(
      createMockRequest({ url: `http://localhost:3000/api/products/${SLUG}` }),
      params(),
    );

    expect(response.status).toBe(401);
  });
});

describe("PUT /api/products/[slug]", () => {
  it("keeps photos in the given order and adds the new ones after them", async () => {
    const form = new FormData();
    form.set("name", "Frontal wig");
    form.set("price", "45000");
    form.set("tracksStock", "true");
    form.set("options", JSON.stringify([{ id: "opt_1", name: '20"', stock: 6 }]));
    form.set(
      "keepPhotos",
      JSON.stringify([
        "https://cdn.test/old-2.jpg",
        "https://cdn.test/old-1.jpg",
      ]),
    );
    form.set("isActive", "false");
    const added = new File(["new"], "new.jpg", { type: "image/jpeg" });
    form.append("photos", added);

    const request = createMockRequest({
      method: "PUT",
      url: `http://localhost:3000/api/products/${SLUG}`,
      cookies: authenticatedCookies(),
      headers: { "content-type": "multipart/form-data; boundary=test" },
    });
    request.formData = async () => form;

    mockedCloudinary.uploadFile.mockResolvedValue({
      secure_url: "https://cdn.test/new.jpg",
    });

    const response = await PUT(request, params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toBe("Product updated successfully");
    expect(mockedCloudinary.uploadFile).toHaveBeenCalledTimes(1);
    expect(mockedCloudinary.uploadFile).toHaveBeenCalledWith(added, {
      folder: `sara/${BUSINESS.id}/products`,
    });
    expect(mockedProduct.update).toHaveBeenCalledWith(
      BUSINESS.id,
      SLUG,
      expect.objectContaining({
        name: "Frontal wig",
        price: 45000,
        isActive: false,
        photos: [
          "https://cdn.test/old-2.jpg",
          "https://cdn.test/old-1.jpg",
          "https://cdn.test/new.jpg",
        ],
      }),
    );
  });

  it("leaves photos alone when neither keepPhotos nor files are sent", async () => {
    const form = new FormData();
    form.set("name", "Frontal wig");

    const request = createMockRequest({
      method: "PUT",
      url: `http://localhost:3000/api/products/${SLUG}`,
      cookies: authenticatedCookies(),
      headers: { "content-type": "multipart/form-data; boundary=test" },
    });
    request.formData = async () => form;

    await PUT(request, params());

    const patch = mockedProduct.update.mock.calls[0]![2];
    expect(patch).not.toHaveProperty("photos");
  });

  it("needs a session", async () => {
    const response = await PUT(
      createMockRequest({
        method: "PUT",
        url: `http://localhost:3000/api/products/${SLUG}`,
      }),
      params(),
    );

    expect(response.status).toBe(401);
    expect(mockedProduct.update).not.toHaveBeenCalled();
  });
});
