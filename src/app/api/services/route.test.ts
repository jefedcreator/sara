import { beforeEach, describe, expect, it, vi } from "vitest";
import { authenticatedCookies, createMockRequest, mockAuthenticatedSession } from "@/backend/test-utils/mock-request";

vi.mock("@/server/db", () => {
  const db: any = {
    session: { findUnique: vi.fn(), delete: vi.fn() },
    business: { findUnique: vi.fn() },
    service: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  };
  return { db };
});
vi.mock("@/backend/services/cloudinary", () => ({ cloudinaryService: { uploadFile: vi.fn() } }));

import { db } from "@/server/db";
import { cloudinaryService } from "@/backend/services/cloudinary";
import { POST } from "./route";
const mockedDb = db as any;
const BUSINESS = { id: "biz_1", ownerId: "user_1", name: "Salon" };
const USER = { id: "user_1", name: "Owner", email: "owner@example.com" };
let inTransaction = false;

beforeEach(() => {
  vi.resetAllMocks();
  inTransaction = false;
  mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });
  mockedDb.business.findUnique.mockResolvedValue(BUSINESS);
  mockedDb.service.findFirst.mockResolvedValue(null);
  mockedDb.service.findUnique.mockResolvedValue(null);
  mockedDb.service.create.mockImplementation(async ({ data }: any) => ({ id: "svc_1", ...data }));
  mockedDb.$transaction.mockImplementation(async (work: any) => {
    inTransaction = true;
    try { return await work(mockedDb); } finally { inTransaction = false; }
  });
});

describe("POST /api/services", () => {
  it("preserves the created response envelope and shared booking setup", async () => {
    const response = await POST(createMockRequest({
      method: "POST", cookies: authenticatedCookies(), headers: { "content-type": "application/json" },
      body: { name: "Haircut", price: 10000, duration: 60 },
    }), {});
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body).toEqual(expect.objectContaining({ status: 201, message: "Service created successfully", data: expect.objectContaining({ name: "Haircut", availableFrom: "08:00", availableTo: "17:00" }) }));
  });

  it("uploads a web photo once before opening the serializable transaction", async () => {
    const image = new File(["photo"], "service.png", { type: "image/png" });
    const form = new FormData();
    form.set("name", "Haircut"); form.set("price", "10000"); form.set("duration", "60"); form.set("image", image);
    const request = createMockRequest({ method: "POST", cookies: authenticatedCookies(), headers: { "content-type": "multipart/form-data" } });
    request.formData = async () => form;
    vi.mocked(cloudinaryService.uploadFile).mockImplementationOnce(async () => {
      expect(inTransaction).toBe(false);
      expect(mockedDb.$transaction).not.toHaveBeenCalled();
      return { secure_url: "https://images.example/service.png" } as never;
    });
    const response = await POST(request, {});
    expect(response.status).toBe(201);
    expect(cloudinaryService.uploadFile).toHaveBeenCalledOnce();
    expect(mockedDb.service.create).toHaveBeenCalledWith({ data: expect.objectContaining({ image: "https://images.example/service.png" }) });
  });

  it("returns a name conflict without inserting another service", async () => {
    mockedDb.service.findFirst.mockResolvedValue({ id: "existing" });
    const response = await POST(createMockRequest({
      method: "POST", cookies: authenticatedCookies(), headers: { "content-type": "application/json" },
      body: { name: "Haircut", price: 10000, duration: 60 },
    }), {});
    expect(response.status).toBe(409);
    expect(mockedDb.service.create).not.toHaveBeenCalled();
  });
});
