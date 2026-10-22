import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  authenticatedCookies,
  createMockRequest,
  mockAuthenticatedSession,
} from "@/backend/test-utils/mock-request";

vi.mock("@/server/db", () => ({
  db: {
    session: { findUnique: vi.fn(), delete: vi.fn() },
    business: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/backend/services/atlas", () => ({
  atlasService: { geocode: vi.fn() },
}));

vi.mock("@/backend/services/mono", () => ({
  monoService: { exchangeToken: vi.fn(), getAccountDetails: vi.fn() },
}));

vi.mock("@/backend/services/paystack", () => ({
  paystackService: { createSubaccount: vi.fn() },
}));

import { atlasService } from "@/backend/services/atlas";
import { monoService } from "@/backend/services/mono";
import { paystackService } from "@/backend/services/paystack";
import { db } from "@/server/db";

import { POST, PUT } from "./route";

const mockedDb = db as any;
const mockedAtlas = atlasService as any;
const mockedMono = monoService as any;
const mockedPaystack = paystackService as any;

const USER = { id: "user_1", name: "Owner", email: "owner@example.com" };

const BUSINESS = {
  id: "biz_1",
  ownerId: USER.id,
  name: "Tobi Beauty",
  slug: "tobi-beauty",
  address: "12 Admiralty Way, Lekki",
  sells: "SERVICES",
  offersDelivery: false,
  deliveryFee: null,
  offersPickup: false,
  paystackSubaccountCode: null,
};

function multipartRequest(form: FormData) {
  const request = createMockRequest({
    method: "POST",
    url: "http://localhost:3000/api/business",
    cookies: authenticatedCookies(),
    headers: { "content-type": "multipart/form-data; boundary=test" },
  });
  request.formData = async () => form;
  return request;
}

function buildForm() {
  const form = new FormData();
  form.set("name", "Tobi Beauty");
  form.set("monoCode", "code_test");
  form.set("address", "12 Admiralty Way, Lekki");
  form.set("currency", "NGN");
  form.set("country", "Nigeria");
  form.set("sells", "BOTH");
  form.set("offersDelivery", "true");
  form.set("deliveryFee", "3000");
  form.set("offersPickup", "true");
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });
  mockedDb.business.update.mockResolvedValue(BUSINESS);
});

describe("PUT /api/business", () => {
  it("saves what you sell, delivery and pickup", async () => {
    const request = createMockRequest({
      method: "PUT",
      cookies: authenticatedCookies(),
      headers: { "content-type": "application/json" },
      body: {
        sells: "BOTH",
        offersDelivery: true,
        deliveryFee: 3000,
        offersPickup: true,
      },
    });

    const response = await PUT(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toBe("Business updated successfully");
    expect(mockedDb.business.update).toHaveBeenCalledWith({
      where: { ownerId: USER.id },
      data: expect.objectContaining({
        sells: "BOTH",
        offersDelivery: true,
        deliveryFee: 3000,
        offersPickup: true,
      }),
    });
  });

  it("reuses the saved address when pickup is turned on", async () => {
    const request = createMockRequest({
      method: "PUT",
      cookies: authenticatedCookies(),
      headers: { "content-type": "application/json" },
      body: { offersPickup: true },
    });

    const response = await PUT(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(200);
    expect(mockedDb.business.update).toHaveBeenCalledWith({
      where: { ownerId: USER.id },
      data: expect.objectContaining({ offersPickup: true }),
    });
  });

  it("refuses pickup without a business address", async () => {
    mockAuthenticatedSession(mockedDb, {
      user: USER,
      business: { ...BUSINESS, address: null },
    });

    const request = createMockRequest({
      method: "PUT",
      cookies: authenticatedCookies(),
      headers: { "content-type": "application/json" },
      body: { offersPickup: true },
    });

    const response = await PUT(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).toBe("Add your business address for pickup");
    expect(mockedDb.business.update).not.toHaveBeenCalled();
  });

  it("refuses an emptied address while pickup is on", async () => {
    mockAuthenticatedSession(mockedDb, {
      user: USER,
      business: { ...BUSINESS, offersPickup: true },
    });

    const request = createMockRequest({
      method: "PUT",
      cookies: authenticatedCookies(),
      headers: { "content-type": "application/json" },
      body: { address: "" },
    });

    const response = await PUT(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(400);
    expect(mockedDb.business.update).not.toHaveBeenCalled();
  });

  it("refuses a cleared fee while delivery stays on", async () => {
    mockAuthenticatedSession(mockedDb, {
      user: USER,
      business: { ...BUSINESS, offersDelivery: true, deliveryFee: 3000 },
    });

    const request = createMockRequest({
      method: "PUT",
      cookies: authenticatedCookies(),
      headers: { "content-type": "application/json" },
      body: { deliveryFee: null },
    });

    const response = await PUT(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(400);
    expect(mockedDb.business.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/business", () => {
  it("saves what you sell, delivery and pickup", async () => {
    mockAuthenticatedSession(mockedDb, { user: USER, business: null });
    mockedAtlas.geocode.mockResolvedValue([]);
    mockedMono.exchangeToken.mockResolvedValue({ id: "mono_1" });
    mockedMono.getAccountDetails.mockResolvedValue({
      institution: { bank_code: "044" },
      account_number: "0123456789",
      name: "Tobi Beauty",
    });
    mockedPaystack.createSubaccount.mockResolvedValue({
      subaccount_code: "ACCT_test",
    });
    mockedDb.business.findUnique.mockResolvedValue(null);
    mockedDb.business.create.mockResolvedValue({
      ...BUSINESS,
      sells: "BOTH",
      offersDelivery: true,
      deliveryFee: 3000,
      offersPickup: true,
    });

    const response = await POST(multipartRequest(buildForm()), {
      params: Promise.resolve({}),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({
      sells: "BOTH",
      offersDelivery: true,
      deliveryFee: 3000,
      offersPickup: true,
    });
    expect(mockedDb.business.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sells: "BOTH",
        offersDelivery: true,
        deliveryFee: 3000,
        offersPickup: true,
      }),
    });
  });
});
