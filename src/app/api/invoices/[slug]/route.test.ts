import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticatedCookies,
  createMockRequest,
  mockAuthenticatedSession,
} from "@/backend/test-utils/mock-request";

vi.mock("@/server/db", () => {
  const db: any = {
    session: { findUnique: vi.fn(), delete: vi.fn() },
    invoice: { findUnique: vi.fn(), update: vi.fn() },
  };
  db.$transaction = vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db));
  return { db };
});
vi.mock("@/backend/services/pdf", () => ({
  generateInvoicePdf: vi.fn().mockResolvedValue(Buffer.from("pdf")),
}));
vi.mock("@/backend/services/cloudinary", () => ({
  cloudinaryService: {
    uploadImage: vi.fn().mockResolvedValue({ secure_url: "https://cdn.test/INV-1001.pdf" }),
  },
}));

import { db } from "@/server/db";
import { PUT } from "./route";

const mockedDb = db as any;
const BUSINESS = { id: "biz_1", ownerId: "user_1" };
const USER = { id: "user_1", name: "Owner", email: "owner@example.com" };

function invoice(status: string) {
  return {
    id: "inv_1",
    slug: "inv-1",
    status,
    total: 30000,
    business: { ownerId: "user_1" },
  };
}

function put(body: unknown) {
  return PUT(
    createMockRequest({
      method: "PUT",
      url: "http://localhost:3000/api/invoices/inv-1",
      cookies: authenticatedCookies(),
      headers: { "content-type": "application/json" },
      body,
    }),
    { params: Promise.resolve({ slug: "inv-1" }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });
  mockedDb.invoice.update.mockImplementation(async ({ data }: any) => ({
    id: "inv_1",
    invoiceNumber: "INV-1001",
    status: data.status ?? "PARTIALLY_PAID",
    currency: "NGN",
    subtotal: 30000,
    taxAmount: 0,
    discount: 0,
    total: 30000,
    amountPaid: data.amountPaid ?? 0,
    clientName: "Ada",
    business: { id: "biz_1", name: "Tobi Beauty" },
    services: [],
    ...data,
  }));
});

describe("PUT /api/invoices/[slug]", () => {
  it("records a further payment on a part-paid invoice", async () => {
    mockedDb.invoice.findUnique.mockResolvedValue(invoice("PARTIALLY_PAID"));
    const response = await put({ status: "PAID", amountPaid: 30000 });
    expect(response.status).toBe(200);
  });

  it("refuses other changes to a part-paid invoice", async () => {
    mockedDb.invoice.findUnique.mockResolvedValue(invoice("PARTIALLY_PAID"));
    const response = await put({ name: "Someone else" });
    expect(response.status).toBe(400);
    expect(mockedDb.invoice.update).not.toHaveBeenCalled();
  });

  it("refuses any change to a paid invoice", async () => {
    mockedDb.invoice.findUnique.mockResolvedValue(invoice("PAID"));
    const response = await put({ status: "PAID", amountPaid: 30000 });
    expect(response.status).toBe(400);
  });

  it("refuses a payment above the total", async () => {
    mockedDb.invoice.findUnique.mockResolvedValue(invoice("SENT"));
    const response = await put({ status: "PAID", amountPaid: 50000 });
    expect(response.status).toBe(400);
    expect(mockedDb.invoice.update).not.toHaveBeenCalled();
  });
});
