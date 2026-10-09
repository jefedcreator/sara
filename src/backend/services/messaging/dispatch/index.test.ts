import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", async (importOriginal) => {
  const { env } = await importOriginal<typeof import("@/env")>();
  return { env: { ...env, NEXT_PUBLIC_APP_URL: "https://app.sara.ng" } };
});
vi.mock("@/server/db", () => {
  const db: any = {
    business: { findUnique: vi.fn() },
    service: { findMany: vi.fn() },
    invoice: { findMany: vi.fn(), count: vi.fn() },
    booking: { findMany: vi.fn() },
    payment: { aggregate: vi.fn() },
  };
  return { db };
});
vi.mock("@/backend/services/invoice", () => ({ invoiceService: { create: vi.fn() } }));
vi.mock("@/backend/services/receipt", () => ({ receiptService: { create: vi.fn() } }));

import { invoiceService } from "@/backend/services/invoice";
import { receiptService } from "@/backend/services/receipt";
import { db } from "@/server/db";
import { intentDispatcher } from "./index";

const mockedDb = db as any;
const BUSINESS = { id: "biz_1", currency: "NGN" };

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.business.findUnique.mockResolvedValue(BUSINESS);
});

describe("createInvoice", () => {
  it("creates a SENT invoice in business currency and returns number + link", async () => {
    (invoiceService.create as any).mockResolvedValue({
      invoiceNumber: "INV-1012", slug: "acme-inv-1012", publicId: "Xk39fjQ2aB7mN0pR", url: "https://cdn.test/INV-1012.pdf",
    });
    const result = await intentDispatcher.createInvoice("biz_1", {
      customerName: "Ada", amount: 15000, description: "gele",
    });
    expect(invoiceService.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SENT", currency: "NGN", total: 15000, amountPaid: 0, notes: "gele" }),
    );
    // The customer's page (with its own preview card), not the bare PDF.
    expect(result.number).toBe("INV-1012");
    expect(result.link).toBe("https://app.sara.ng/invoices/Xk39fjQ2aB7mN0pR");
  });
});

describe("createReceipt", () => {
  it("creates a fully-paid receipt", async () => {
    (receiptService.create as any).mockResolvedValue({
      receiptNumber: "RCP-1007", slug: "acme-rcp-1007", publicId: "b7T0qLm2Vn9cZ4wE", url: "https://cdn.test/RCP-1007.pdf",
    });
    const result = await intentDispatcher.createReceipt("biz_1", { customerName: "Ada", amount: 15000 });
    expect(receiptService.create).toHaveBeenCalledWith(expect.objectContaining({ total: 15000, amountPaid: 15000 }));
    expect(result.number).toBe("RCP-1007");
    expect(result.link).toBe("https://app.sara.ng/receipts/b7T0qLm2Vn9cZ4wE");
  });
});

describe("service options + booking link", () => {
  it("lists active services and builds a booking link", async () => {
    mockedDb.service.findMany.mockResolvedValue([
      { slug: "acme-haircut", name: "Haircut", price: 5000, duration: 60, currency: "NGN", bookingMode: "SLOT" },
    ]);
    const options = await intentDispatcher.listServiceOptions("biz_1");
    expect(options).toEqual([{ slug: "acme-haircut", label: "Haircut — NGN 5,000 (1 hr)" }]);
    expect(intentDispatcher.bookingLinkText(options[0]!)).toContain(
      "https://app.sara.ng/services/acme-haircut",
    );
  });
});

describe("listUnpaidInvoices", () => {
  it("summarises unpaid invoices", async () => {
    mockedDb.invoice.findMany.mockResolvedValue([
      { invoiceNumber: "INV-1001", clientName: "Ada", total: 15000, amountPaid: 0, currency: "NGN" },
    ]);
    const text = await intentDispatcher.listUnpaidInvoices("biz_1");
    expect(text).toContain("Ada");
    expect(text).toContain("INV-1001");
  });
  it("handles an empty list", async () => {
    mockedDb.invoice.findMany.mockResolvedValue([]);
    expect((await intentDispatcher.listUnpaidInvoices("biz_1")).toLowerCase()).toContain("no unpaid");
  });
});

describe("listFullServiceOptions", () => {
  it("returns active services with IDs, names, prices and formatted labels", async () => {
    mockedDb.service.findMany.mockResolvedValue([
      { id: "srv_1", slug: "box-braids", name: "Box Braids", price: 15000, duration: 120, bookingMode: "SLOT" },
    ]);
    const options = await intentDispatcher.listFullServiceOptions("biz_1");
    expect(options).toEqual([
      {
        id: "srv_1",
        slug: "box-braids",
        name: "Box Braids",
        price: 15000,
        currency: "NGN",
        label: "Box Braids — NGN 15,000 (2 hr)",
      },
    ]);
  });
});

describe("createInvoice with services", () => {
  it("forwards line items to invoiceService.create", async () => {
    (invoiceService.create as any).mockResolvedValue({
      invoiceNumber: "INV-1013", slug: "acme-inv-1013", publicId: "pub_1013",
    });
    await intentDispatcher.createInvoice("biz_1", {
      customerName: "Ada",
      amount: 30000,
      description: "Braids",
      services: [
        { serviceId: "srv_1", quantity: 2, unitPrice: 15000, total: 30000, description: "Box Braids" },
      ],
    });
    expect(invoiceService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        services: [
          { serviceId: "srv_1", quantity: 2, unitPrice: 15000, total: 30000, description: "Box Braids" },
        ],
      }),
    );
  });
});

describe("createReceipt with services", () => {
  it("forwards line items to receiptService.create", async () => {
    (receiptService.create as any).mockResolvedValue({
      receiptNumber: "RCP-1008", slug: "acme-rcp-1008", publicId: "pub_1008",
    });
    await intentDispatcher.createReceipt("biz_1", {
      customerName: "Ada",
      amount: 15000,
      services: [
        { serviceId: "srv_1", quantity: 1, unitPrice: 15000, total: 15000, description: "Box Braids" },
      ],
    });
    expect(receiptService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        services: [
          { serviceId: "srv_1", quantity: 1, unitPrice: 15000, total: 15000, description: "Box Braids" },
        ],
      }),
    );
  });
});

