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
    order: { findUnique: vi.fn() },
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
vi.mock("@/backend/services/email/documents", () => ({
  emailInvoice: vi.fn().mockResolvedValue(undefined),
  emailReceipt: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/backend/services/order", () => ({
  orderService: {
    createFromInvoice: vi.fn().mockResolvedValue(null),
    setStatus: vi.fn().mockResolvedValue({}),
  },
}));

import { db } from "@/server/db";
import { orderService } from "@/backend/services/order";
import { emailInvoice } from "@/backend/services/email/documents";
import { PUT } from "./route";

const mockedDb = db as any;
const BUSINESS = { id: "biz_1", ownerId: "user_1" };
const USER = { id: "user_1", name: "Owner", email: "owner@example.com" };

function invoice(status: string, amountPaid = 0, total = 30000) {
  return {
    id: "inv_1",
    slug: "inv-1",
    businessId: "biz_1",
    status,
    total,
    amountPaid,
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
    clientEmail: "ada@example.com",
    business: { id: "biz_1", name: "Tobi Beauty" },
    lines: [],
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

  it("updates details on a SENT invoice and re-sends invoice email", async () => {
    mockedDb.invoice.findUnique.mockResolvedValue({
      ...invoice("SENT"),
      clientEmail: "ada@example.com",
      lines: [],
    });
    mockedDb.invoice.update.mockResolvedValue({
      id: "inv_1",
      invoiceNumber: "INV-1001",
      status: "SENT",
      currency: "NGN",
      subtotal: 30000,
      taxAmount: 0,
      discount: 0,
      total: 30000,
      amountPaid: 0,
      clientEmail: "ada@example.com",
      clientName: "Ada Updated",
      clientPhone: null,
      dueAt: null,
      sentAt: null,
      paidAt: null,
      notes: null,
      business: { id: "biz_1", name: "Tobi Beauty" },
      lines: [],
    });
    const response = await put({ name: "Ada Updated" });
    expect(response.status).toBe(200);
    expect(mockedDb.invoice.update).toHaveBeenCalled();
    expect(emailInvoice).toHaveBeenCalled();
  });
});

describe("PUT /api/invoices/[slug] orders", () => {
  it("creates the order on the first payment, in the same transaction", async () => {
    mockedDb.invoice.findUnique.mockResolvedValue(invoice("SENT", 0, 50000));

    const response = await put({ status: "PARTIALLY_PAID", amountPaid: 20000 });

    expect(response.status).toBe(200);
    expect(orderService.createFromInvoice).toHaveBeenCalledTimes(1);
    expect(orderService.createFromInvoice).toHaveBeenCalledWith(mockedDb, "inv_1");
    expect(mockedDb.$transaction).toHaveBeenCalled();
  });

  it("a second part payment doesn't create another order", async () => {
    mockedDb.invoice.findUnique.mockResolvedValue(
      invoice("PARTIALLY_PAID", 20000, 50000),
    );

    const response = await put({ status: "PARTIALLY_PAID", amountPaid: 40000 });

    expect(response.status).toBe(200);
    expect(orderService.createFromInvoice).not.toHaveBeenCalled();
  });

  it("settling the balance of a part-paid invoice doesn't create another order", async () => {
    mockedDb.invoice.findUnique.mockResolvedValue(
      invoice("PARTIALLY_PAID", 20000, 50000),
    );

    const response = await put({ status: "PAID", amountPaid: 50000 });

    expect(response.status).toBe(200);
    expect(orderService.createFromInvoice).not.toHaveBeenCalled();
  });

  it("doesn't create an order for an edit that records no money", async () => {
    mockedDb.invoice.findUnique.mockResolvedValue(invoice("SENT"));

    const response = await put({ name: "Ada Updated" });

    expect(response.status).toBe(200);
    expect(orderService.createFromInvoice).not.toHaveBeenCalled();
  });

  it("voiding with cancelOrder cancels the order, which puts its stock back", async () => {
    mockedDb.invoice.findUnique.mockResolvedValue(invoice("PARTIALLY_PAID", 20000, 50000));
    mockedDb.order.findUnique.mockResolvedValue({ slug: "tobi-hair-abc", status: "NEW" });

    const response = await put({ status: "VOID", cancelOrder: true });

    expect(response.status).toBe(200);
    expect(mockedDb.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { invoiceId: "inv_1" } }),
    );
    expect(orderService.setStatus).toHaveBeenCalledWith(
      "biz_1",
      "tobi-hair-abc",
      "CANCELLED",
    );
  });

  it("voiding without cancelOrder leaves the order alone", async () => {
    mockedDb.invoice.findUnique.mockResolvedValue(invoice("PARTIALLY_PAID", 20000, 50000));
    mockedDb.order.findUnique.mockResolvedValue({ slug: "tobi-hair-abc", status: "NEW" });

    const response = await put({ status: "VOID" });

    expect(response.status).toBe(200);
    expect(orderService.setStatus).not.toHaveBeenCalled();
  });

  it("leaves a completed order alone even when asked to cancel it", async () => {
    mockedDb.invoice.findUnique.mockResolvedValue(invoice("PARTIALLY_PAID", 20000, 50000));
    mockedDb.order.findUnique.mockResolvedValue({ slug: "tobi-hair-abc", status: "COMPLETED" });

    const response = await put({ status: "VOID", cancelOrder: true });

    expect(response.status).toBe(200);
    expect(orderService.setStatus).not.toHaveBeenCalled();
  });

  it("voids an invoice that never made an order", async () => {
    mockedDb.invoice.findUnique.mockResolvedValue(invoice("SENT"));
    mockedDb.order.findUnique.mockResolvedValue(null);

    const response = await put({ status: "VOID", cancelOrder: true });

    expect(response.status).toBe(200);
    expect(orderService.setStatus).not.toHaveBeenCalled();
  });
});
