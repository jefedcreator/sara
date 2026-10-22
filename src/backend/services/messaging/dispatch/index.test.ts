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
    order: { findMany: vi.fn() },
  };
  return { db };
});
vi.mock("@/backend/services/invoice", () => ({ invoiceService: { create: vi.fn() } }));
vi.mock("@/backend/services/receipt", () => ({ receiptService: { create: vi.fn() } }));
vi.mock("@/backend/services/product", () => ({ productService: { list: vi.fn() } }));

import { invoiceService } from "@/backend/services/invoice";
import { productService } from "@/backend/services/product";
import { receiptService } from "@/backend/services/receipt";
import { db } from "@/server/db";
import { intentDispatcher } from "./index";

const mockedDb = db as any;
const mockedProducts = productService as any;
const BUSINESS = { id: "biz_1", currency: "NGN" };

/** An active product as productService.list returns it, with its active options. */
function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: "prd_1",
    slug: "frontal-wig",
    businessId: "biz_1",
    name: "Frontal wig",
    price: 45000,
    tracksStock: true,
    isActive: true,
    options: [
      { id: "opt_20", productId: "prd_1", name: '20"', price: null, stock: 8, position: 0, isActive: true },
      { id: "opt_24", productId: "prd_1", name: '24"', price: 52000, stock: 3, position: 1, isActive: true },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.business.findUnique.mockResolvedValue(BUSINESS);
  mockedDb.service.findMany.mockResolvedValue([]);
  mockedProducts.list.mockResolvedValue([]);
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

describe("listItemOptions", () => {
  it("returns active services with IDs, names, prices and formatted labels", async () => {
    mockedDb.service.findMany.mockResolvedValue([
      { id: "srv_1", slug: "box-braids", name: "Box Braids", price: 15000, duration: 120, bookingMode: "SLOT" },
    ]);
    const options = await intentDispatcher.listItemOptions("biz_1");
    expect(options).toEqual([
      {
        kind: "SERVICE",
        id: "srv_1",
        slug: "box-braids",
        name: "Box Braids",
        price: 15000,
        currency: "NGN",
        label: "Box Braids — NGN 15,000 (2 hr)",
      },
    ]);
  });

  it("offers product options in the invoice item list", async () => {
    mockedDb.service.findMany.mockResolvedValue([
      { id: "srv_1", slug: "box-braids", name: "Box Braids", price: 15000, duration: 120, bookingMode: "SLOT" },
    ]);
    mockedProducts.list.mockResolvedValue([makeProduct()]);
    const options = await intentDispatcher.listItemOptions("biz_1");
    expect(mockedProducts.list).toHaveBeenCalledWith("biz_1");
    expect(options.map((o) => o.kind)).toEqual(["SERVICE", "PRODUCT", "PRODUCT"]);
    expect(options[1]).toEqual({
      kind: "PRODUCT",
      id: "opt_20",
      productOptionId: "opt_20",
      slug: "frontal-wig",
      name: 'Frontal wig — 20"',
      price: 45000,
      currency: "NGN",
      label: 'Frontal wig — 20" — NGN 45,000 (8 in stock)',
    });
    // An option's own price wins over the product's, and low stock reads "3 left".
    expect(options[2]).toMatchObject({ price: 52000, label: 'Frontal wig — 24" — NGN 52,000 (3 left)' });
  });

  it("labels a product that doesn't track stock as made to order", async () => {
    mockedProducts.list.mockResolvedValue([
      makeProduct({
        tracksStock: false,
        options: [{ id: "opt_1", productId: "prd_1", name: "", price: null, stock: 0, position: 0, isActive: true }],
      }),
    ]);
    const options = await intentDispatcher.listItemOptions("biz_1");
    expect(options).toHaveLength(1);
    expect(options[0]!.label).toBe("Frontal wig — NGN 45,000 (Made to order)");
  });
});

describe("listShareOptions", () => {
  it("labels products in the share list with stock", async () => {
    mockedDb.service.findMany.mockResolvedValue([
      { id: "srv_1", slug: "acme-haircut", name: "Haircut", price: 5000, duration: 60, bookingMode: "SLOT" },
    ]);
    mockedProducts.list.mockResolvedValue([makeProduct()]);
    const options = await intentDispatcher.listShareOptions("biz_1");
    expect(options).toEqual([
      { kind: "SERVICE", slug: "acme-haircut", label: "Haircut — NGN 5,000 (1 hr)" },
      { kind: "PRODUCT", slug: "frontal-wig", label: "Frontal wig — NGN 45,000 (11 in stock)" },
    ]);
  });

  it("marks a product with nothing left as sold out", async () => {
    mockedProducts.list.mockResolvedValue([
      makeProduct({
        options: [{ id: "opt_1", productId: "prd_1", name: "", price: null, stock: 0, position: 0, isActive: true }],
      }),
    ]);
    const options = await intentDispatcher.listShareOptions("biz_1");
    expect(options).toEqual([{ kind: "PRODUCT", slug: "frontal-wig", label: "Frontal wig — NGN 45,000 (Sold out)" }]);
  });
});

describe("productLinkText", () => {
  it("writes a product link message", () => {
    const link = "https://app.sara.ng/products/frontal-wig";
    expect(intentDispatcher.productLinkText("frontal-wig")).toBe(
      `Share this product link with your customer:\n${link}\n— — —\nHi! You can buy it here: ${link}\n— — —`,
    );
  });
});

describe("ordersToSendOutText", () => {
  it("lists orders to send out", async () => {
    mockedDb.order.findMany.mockResolvedValue([
      { slug: "o1", orderNumber: "ORD-1022", clientName: "Tolu Adeyemi", status: "NEW", fulfilment: "DELIVERY", total: 93000 },
      { slug: "o2", orderNumber: "ORD-1023", clientName: "Kemi Bello", status: "READY", fulfilment: "PICKUP", total: 45000 },
    ]);
    const text = await intentDispatcher.ordersToSendOutText("biz_1");
    expect(text).toBe(
      "📦 Orders to send out:\n" +
        "1. ORD-1022 · Tolu Adeyemi · Delivery · New\n" +
        "2. ORD-1023 · Kemi Bello · Pickup · Ready for pickup",
    );
    expect(mockedDb.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: "biz_1", status: { in: ["NEW", "READY"] } } }),
    );
  });

  it("says when there is nothing to send out", async () => {
    mockedDb.order.findMany.mockResolvedValue([]);
    expect(await intentDispatcher.ordersToSendOutText("biz_1")).toBe("✅ Nothing to send out.");
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
      lines: [
        { serviceId: "srv_1", quantity: 2, unitPrice: 15000, total: 30000, description: "Box Braids" },
      ],
    });
    expect(invoiceService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [
          { serviceId: "srv_1", quantity: 2, unitPrice: 15000, total: 30000, description: "Box Braids" },
        ],
      }),
    );
  });
});

describe("createInvoice for a picked customer", () => {
  it("passes the customer the owner picked in the chat", async () => {
    (invoiceService.create as any).mockResolvedValue({
      invoiceNumber: "INV-1020", slug: "acme-inv-1020", publicId: "pub_1020",
    });
    await intentDispatcher.createInvoice("biz_1", {
      customerName: "Tolu Adeyemi",
      customerId: "cus_1",
      amount: 90000,
      lines: [
        { productOptionId: "opt_20", quantity: 2, unitPrice: 45000, total: 90000, description: 'Frontal wig — 20"' },
      ],
    });
    expect(invoiceService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Tolu Adeyemi",
        customerId: "cus_1",
        lines: [
          { productOptionId: "opt_20", quantity: 2, unitPrice: 45000, total: 90000, description: 'Frontal wig — 20"' },
        ],
      }),
    );
  });

  it("leaves the customer to be matched by name when none was picked", async () => {
    (receiptService.create as any).mockResolvedValue({
      receiptNumber: "RCP-1009", slug: "acme-rcp-1009", publicId: "pub_1009",
    });
    await intentDispatcher.createReceipt("biz_1", { customerName: "Kemi", amount: 5000 });
    expect(receiptService.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Kemi", customerId: null }),
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
      lines: [
        { serviceId: "srv_1", quantity: 1, unitPrice: 15000, total: 15000, description: "Box Braids" },
      ],
    });
    expect(receiptService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [
          { serviceId: "srv_1", quantity: 1, unitPrice: 15000, total: 15000, description: "Box Braids" },
        ],
      }),
    );
  });
});

