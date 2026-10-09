import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticatedCookies,
  createMockRequest,
  mockAuthenticatedSession,
} from "@/backend/test-utils/mock-request";

vi.mock("@/server/db", () => {
  const db: any = {
    session: { findUnique: vi.fn(), delete: vi.fn() },
    receipt: { findUnique: vi.fn(), update: vi.fn() },
  };
  return { db };
});
vi.mock("@/backend/services/pdf", () => ({
  generateReceiptPdf: vi.fn().mockResolvedValue(Buffer.from("pdf")),
}));
vi.mock("@/backend/services/cloudinary", () => ({
  cloudinaryService: {
    uploadImage: vi.fn().mockResolvedValue({ secure_url: "https://cdn.test/RCP-1001.pdf" }),
  },
}));
vi.mock("@/backend/services/email/documents", () => ({
  emailReceipt: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "@/server/db";
import { emailReceipt } from "@/backend/services/email/documents";
import { PUT } from "./route";

const mockedDb = db as any;
const BUSINESS = { id: "biz_1", ownerId: "user_1" };
const USER = { id: "user_1", name: "Owner", email: "owner@example.com" };

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    id: "rcp_1",
    slug: "rcp-1",
    receiptNumber: "RCP-1001",
    currency: "NGN",
    subtotal: 10000,
    taxAmount: 0,
    discount: 0,
    total: 10000,
    amountPaid: 10000,
    paymentMethod: "CASH",
    name: "Customer",
    email: "customer@example.com",
    createdAt: new Date(),
    business: { id: "biz_1", ownerId: "user_1", name: "Sara Business" },
    payment: null,
    services: [],
    ...overrides,
  };
}

function put(body: unknown) {
  return PUT(
    createMockRequest({
      method: "PUT",
      url: "http://localhost:3000/api/receipts/rcp-1",
      cookies: authenticatedCookies(),
      headers: { "content-type": "application/json" },
      body,
    }),
    { params: Promise.resolve({ slug: "rcp-1" }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });
  mockedDb.receipt.update.mockImplementation(async ({ data }: any) => ({
    ...receipt(),
    ...data,
  }));
});

describe("PUT /api/receipts/[slug]", () => {
  it("updates a standalone manual receipt and sends email", async () => {
    mockedDb.receipt.findUnique.mockResolvedValue(receipt());
    const response = await put({ name: "Updated Customer" });
    expect(response.status).toBe(200);
    expect(mockedDb.receipt.update).toHaveBeenCalled();
    expect(emailReceipt).toHaveBeenCalled();
  });

  it("refuses updating a receipt linked to an invoice payment", async () => {
    mockedDb.receipt.findUnique.mockResolvedValue(
      receipt({ payment: { invoiceId: "inv_123" } }),
    );
    const response = await put({ name: "Updated Customer" });
    expect(response.status).toBe(400);
    expect(mockedDb.receipt.update).not.toHaveBeenCalled();
  });
});
