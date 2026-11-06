import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, customerService, dashboardService, documentService, productService } = vi.hoisted(() => ({
  db: {
    business: { findFirst: vi.fn() },
    service: { findMany: vi.fn(), findFirst: vi.fn() },
    product: { findFirst: vi.fn() },
    order: { count: vi.fn() },
    orderLine: { groupBy: vi.fn() },
  },
  customerService: { list: vi.fn(), detail: vi.fn(), ownedBy: vi.fn(), resolve: vi.fn() },
  dashboardService: {
    unpaidInvoices: vi.fn(), unpaidInvoiceSummary: vi.fn(), bookingsInRange: vi.fn(),
    ordersToSendOut: vi.fn(), summaryForPeriod: vi.fn(), revenueByItem: vi.fn(),
  },
  documentService: { find: vi.fn() },
  productService: { list: vi.fn(), adjustStock: vi.fn() },
}));
vi.mock("@/server/db", () => ({ db }));
vi.mock("@/backend/services/customer", () => ({ customerService }));
vi.mock("@/backend/services/dashboard", () => ({ dashboardService }));
vi.mock("@/backend/services/documents", () => ({ documentService }));
vi.mock("@/backend/services/product", () => ({ productService }));
vi.mock("@/server/share", () => ({
  serviceLink: (slug: string) => `https://sara.test/services/${slug}`,
  productLink: (slug: string) => `https://sara.test/products/${slug}`,
  publicLink: (kind: string, publicId: string) => `https://sara.test/${kind}s/${publicId}`,
}));

import { BadRequestException, NotFoundException } from "@/utils/exceptions";

import type { AssistantScope } from "../types";
import { executeRead } from "./reads";
import { readRequestSchema } from "./schemas";

const scope: AssistantScope = { businessId: "biz_1", channel: "WHATSAPP", principalId: "identity_1" };
const now = new Date("2026-11-03T23:30:00Z"); // Wednesday in Lagos, Tuesday in UTC.
const day = { from: new Date("2026-11-03T23:00:00Z"), to: new Date("2026-11-04T23:00:00Z") };
const customer = {
  id: "cus_1", name: "Tolu Adeyemi", phone: "+2348035550142", email: "tolu@example.com",
  spent: 20000, owes: 40000, lastActivityAt: "2026-10-06T00:00:00.000Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(db.business.findFirst).mockResolvedValue({ currency: "NGN" });
  vi.mocked(db.service.findMany).mockResolvedValue([]);
  vi.mocked(db.orderLine.groupBy).mockResolvedValue([]);
  vi.mocked(productService.list).mockResolvedValue([]);
});

describe("readRequestSchema", () => {
  it("rejects a business override in tool arguments", () => {
    expect(() => readRequestSchema.parse({ name: "get_customer", customerId: "cus_1", businessId: "biz_other" })).toThrow();
  });

  it.each([
    { name: "find_customers", query: "Ada", businessId: "other" },
    { name: "list_items", query: null, includeInactive: false, limit: 200 },
    { name: "unpaid_invoices", customerId: null, period: "all", businessId: "other" },
    { name: "list_bookings", from: "2026-11-04", to: "2026-11-05", businessId: "other" },
    { name: "orders_to_send", businessId: "other" },
    { name: "business_summary", period: "month", byItem: false, businessId: "other" },
    { name: "find_document", kind: "invoice", number: "INV-1", businessId: "other" },
    { name: "share_link", kind: "product", id: "p1", businessId: "other" },
    { name: "get_customer", customerId: 1 },
    { name: "find_customers", query: " " },
    { name: "find_customers", query: "x".repeat(256) },
    { name: "list_bookings", from: "2026-02-30", to: "2026-03-01" },
  ])("rejects invalid or additional arguments: %j", (request) => {
    expect(() => readRequestSchema.parse(request)).toThrow();
  });
});

describe("executeRead", () => {
  it("returns distinguishers and an explicit choice for ambiguous customer matches", async () => {
    vi.mocked(customerService.list).mockResolvedValue({ data: [customer, { ...customer, id: "cus_2", phone: "+2348035559999" }], total: 4 });
    const output = await executeRead(scope, { name: "find_customers", query: "Tolu" }, now);
    expect(customerService.list).toHaveBeenCalledWith("biz_1", { query: "Tolu", page: 1, size: 3 });
    expect(output.text).toContain("Showing 2 of 4");
    expect(output.text).toContain("Several customers match");
    expect(output.text).toContain("+2348035559999");
    expect(output.data).toMatchObject({ total: 4, truncated: true, customers: [{ id: "cus_1" }, { id: "cus_2" }] });
  });

  it("answers a no-match customer search without creating a customer", async () => {
    vi.mocked(customerService.list).mockResolvedValue({ data: [], total: 0 });
    const output = await executeRead(scope, { name: "find_customers", query: "Missing" }, now);
    expect(output.text).toBe("No matching customers found.");
    expect(customerService.resolve).not.toHaveBeenCalled();
  });

  it("returns customer spending and capped history from the scoped detail service", async () => {
    vi.mocked(customerService.detail).mockResolvedValue({
      ...customer, address: "Private address", notes: "Private notes", createdAt: now.toISOString(),
      timeline: Array.from({ length: 25 }, (_, index) => ({ kind: "invoice", id: `inv_${index}`, label: "Invoice INV-1042", amount: 45000, status: "SENT", at: now.toISOString(), href: "/invoices/public_1" })),
    });
    const output = await executeRead(scope, { name: "get_customer", customerId: "cus_1" }, now);
    expect(customerService.detail).toHaveBeenCalledWith("biz_1", "cus_1");
    expect(output.data).toMatchObject({ spent: "20000", owes: "40000", totalHistory: 25, truncated: true });
    expect((output.data as Prisma.JsonObject).timeline).toHaveLength(20);
    expect(output.text).toContain("Spent NGN 20,000");
    expect(output.text).toContain("Showing 20 of 25 history entries");
    expect(JSON.stringify(output.data)).not.toContain("Private");
    expect(db.business.findFirst).toHaveBeenCalledWith({ where: { id: "biz_1" }, select: { currency: true } });
  });

  it("does not expose a customer that the detail service rejects as foreign", async () => {
    vi.mocked(customerService.detail).mockRejectedValue(new NotFoundException("Customer not found"));
    await expect(executeRead(scope, { name: "get_customer", customerId: "cus_foreign" }, now)).rejects.toThrow("Customer not found");
    expect(customerService.detail).toHaveBeenCalledWith("biz_1", "cus_foreign");
    expect(db.business.findFirst).not.toHaveBeenCalled();
  });

  it("reports effective option prices and stock after active owned checkout holds", async () => {
    vi.mocked(db.service.findMany).mockResolvedValue([{
      id: "service_1", name: "Lekki 4B", price: new Prisma.Decimal(45000), isActive: true, bookingMode: "NIGHTLY", duration: 1440, minUnits: 2, maxUnits: 10,
    }]);
    vi.mocked(productService.list).mockResolvedValue([{
      id: "product_1", businessId: "biz_1", name: "Frontal wig", price: new Prisma.Decimal(10000), isActive: true, tracksStock: true,
      options: [
        { id: "option_1", name: '18"', price: null, stock: 8 },
        { id: "option_2", name: '20"', price: new Prisma.Decimal(12500), stock: 4 },
      ],
    }]);
    vi.mocked(db.orderLine.groupBy).mockResolvedValue([
      { productOptionId: "option_1", _sum: { quantity: 3 } },
      { productOptionId: "option_2", _sum: { quantity: 9 } },
    ]);
    const output = await executeRead(scope, { name: "list_items", query: null, includeInactive: true }, now);
    expect(productService.list).toHaveBeenCalledWith("biz_1", { includeInactive: true });
    expect(db.service.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { businessId: "biz_1" } }));
    expect(db.orderLine.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: {
      productOptionId: { in: ["option_1", "option_2"] }, order: { businessId: "biz_1", status: "AWAITING_PAYMENT", holdExpiresAt: { gt: now } },
    } }));
    expect(output.data).toMatchObject({ items: [
      { kind: "service", unit: "night", minUnits: 2 },
      { kind: "product", options: [{ id: "option_1", price: "10000", stock: 8, availableStock: 5 }, { id: "option_2", price: "12500", stock: 4, availableStock: 0 }] },
    ] });
    expect(output.text).toContain("NGN 12,500");
    expect(productService.adjustStock).not.toHaveBeenCalled();
    expect(customerService.resolve).not.toHaveBeenCalled();
  });

  it("caps the combined catalog at 20, filters product options by query and handles untracked stock", async () => {
    vi.mocked(productService.list).mockResolvedValue(Array.from({ length: 24 }, (_, index) => ({
      id: `product_${index}`, name: "Wig", price: new Prisma.Decimal(10000), isActive: true, tracksStock: false,
      options: [{ id: `option_${index}`, name: "Long", price: null, stock: 0 }],
    })));
    const output = await executeRead(scope, { name: "list_items", query: "Long", includeInactive: false }, now);
    expect((output.data as Prisma.JsonObject).items).toHaveLength(20);
    expect(output.data).toMatchObject({ total: 24, truncated: true });
    expect(output.text).toContain("Showing 20 of 24");
    expect(output.text).toContain("Made to order");
  });

  it("uses full unpaid aggregates rather than the displayed invoices", async () => {
    vi.mocked(dashboardService.unpaidInvoices).mockResolvedValue(Array.from({ length: 20 }, (_, index) => ({ slug: `inv-${index}`, invoiceNumber: `INV-${index}`, clientName: "Ada", outstanding: 1000, currency: "NGN", url: null })));
    vi.mocked(dashboardService.unpaidInvoiceSummary).mockResolvedValue({ count: 42, outstanding: 125000, byCurrency: [{ currency: "NGN", count: 42, outstanding: 125000 }] });
    const output = await executeRead(scope, { name: "unpaid_invoices", customerId: "cus_1", period: "today" }, now);
    expect(customerService.ownedBy).toHaveBeenCalledWith(db, "biz_1", "cus_1");
    expect(dashboardService.unpaidInvoices).toHaveBeenCalledWith("biz_1", 20, { customerId: "cus_1", ...day });
    expect(dashboardService.unpaidInvoiceSummary).toHaveBeenCalledWith("biz_1", { customerId: "cus_1", ...day });
    expect(output.text).toContain("Showing 20 of 42 unpaid invoices");
    expect(output.text).toContain("NGN 125,000");
    expect(output.text).toContain("due date");
    expect(output.data).toMatchObject({ total: 42, outstandingByCurrency: [{ outstanding: "125000" }], truncated: true });
  });

  it("does not add a due range to all unpaid invoices", async () => {
    vi.mocked(dashboardService.unpaidInvoices).mockResolvedValue([]);
    vi.mocked(dashboardService.unpaidInvoiceSummary).mockResolvedValue({ count: 0, outstanding: 0, byCurrency: [] });
    const output = await executeRead(scope, { name: "unpaid_invoices", customerId: null, period: "all" }, now);
    expect(dashboardService.unpaidInvoices).toHaveBeenCalledWith("biz_1", 20, {});
    expect(output.text).toBe("No unpaid invoices found.");
  });

  it("rejects a foreign customer before reading its unpaid invoices", async () => {
    vi.mocked(customerService.ownedBy).mockRejectedValue(new BadRequestException("Customer not found for this business"));
    await expect(executeRead(scope, { name: "unpaid_invoices", customerId: "cus_other", period: "all" }, now)).rejects.toThrow("Customer not found");
    expect(dashboardService.unpaidInvoices).not.toHaveBeenCalled();
  });

  it("uses Lagos calendar dates and reports capped start/end events consistently", async () => {
    vi.mocked(dashboardService.bookingsInRange).mockResolvedValue(Array.from({ length: 25 }, (_, index) => ({
      slug: `stay-${index}`, kind: index % 2 ? "CHECK_IN" : "CHECK_OUT", at: day.from, startTime: day.from, endTime: day.to,
      units: 2, status: "CONFIRMED", clientName: "Ada", serviceName: "Lekki 4B",
    })));
    const output = await executeRead(scope, { name: "list_bookings", from: "2026-11-04", to: "2026-11-05" }, now);
    expect(dashboardService.bookingsInRange).toHaveBeenCalledWith("biz_1", day, now);
    expect(output.data).toMatchObject({ total: 25, truncated: true, endExclusive: true });
    expect((output.data as Prisma.JsonObject).events).toHaveLength(20);
    expect(output.text).toContain("CHECK OUT");
    expect(output.text).toContain("CHECK IN");
    expect(output.text).toContain("Lagos");
  });

  it.each([
    { from: "2026-11-01", to: "2026-12-03" },
    { from: "2026-11-05", to: "2026-11-04" },
    { from: "2026-11-04", to: "2026-11-04" },
  ])("rejects an invalid or longer than 31 day range before querying: %j", async (range) => {
    await expect(executeRead(scope, { name: "list_bookings", ...range }, now)).rejects.toThrow("at most 31 days");
    expect(dashboardService.bookingsInRange).not.toHaveBeenCalled();
  });

  it("accepts a 31 day timestamp range", async () => {
    vi.mocked(dashboardService.bookingsInRange).mockResolvedValue([]);
    await executeRead(scope, { name: "list_bookings", from: "2026-11-01T00:00:00+01:00", to: "2026-12-02T00:00:00+01:00" }, now);
    expect(dashboardService.bookingsInRange).toHaveBeenCalled();
  });

  it("counts all orders even though the shared dashboard returns ten", async () => {
    vi.mocked(dashboardService.ordersToSendOut).mockResolvedValue(Array.from({ length: 10 }, (_, index) => ({ slug: `order-${index}`, orderNumber: `ORD-${index}`, clientName: "Ada", status: "NEW", fulfilment: "DELIVERY", total: 45000 })));
    vi.mocked(db.order.count).mockResolvedValue(30);
    const output = await executeRead(scope, { name: "orders_to_send" }, now);
    expect(dashboardService.ordersToSendOut).toHaveBeenCalledWith("biz_1");
    expect(db.order.count).toHaveBeenCalledWith({ where: { businessId: "biz_1", status: { in: ["NEW", "READY"] } } });
    expect(output.data).toMatchObject({ total: 30, truncated: true });
    expect(output.text).toContain("Showing 10 of 30");
  });

  it("uses shared period summaries and item figures, retaining complete summary totals", async () => {
    vi.mocked(dashboardService.summaryForPeriod).mockResolvedValue({ revenue: 45000, unpaidCount: 40, unpaidTotal: 900000 });
    vi.mocked(dashboardService.revenueByItem).mockResolvedValue(Array.from({ length: 25 }, (_, index) => ({ kind: "SERVICE", id: `s${index}`, slug: `s-${index}`, name: "Braids", totalRevenue: 45000, count: 1 })));
    const output = await executeRead(scope, { name: "business_summary", period: "today", byItem: true }, now);
    expect(dashboardService.summaryForPeriod).toHaveBeenCalledWith("biz_1", day);
    expect(dashboardService.revenueByItem).toHaveBeenCalledWith("biz_1", day);
    expect(output.data).toMatchObject({ revenue: "45000", unpaidCount: 40, unpaidTotal: "900000", totalItems: 25, truncated: true });
    expect(output.text).toContain("NGN 900,000");
    expect(output.text).toContain("Showing 20 of 25");
  });

  it("skips item queries for a summary without item figures", async () => {
    vi.mocked(dashboardService.summaryForPeriod).mockResolvedValue({ revenue: 0, unpaidCount: 0, unpaidTotal: 0 });
    await executeRead(scope, { name: "business_summary", period: "month", byItem: false }, now);
    expect(dashboardService.revenueByItem).not.toHaveBeenCalled();
    expect(dashboardService.summaryForPeriod).toHaveBeenCalledWith("biz_1", { from: new Date("2026-10-31T23:00:00Z"), to: new Date("2026-11-30T23:00:00Z") });
  });

  it("reports no matching document and uses the trusted business", async () => {
    vi.mocked(documentService.find).mockResolvedValue(null);
    const output = await executeRead(scope, { name: "find_document", kind: "invoice", number: "INV-1042" }, now);
    expect(documentService.find).toHaveBeenCalledWith("biz_1", "invoice", "INV-1042");
    expect(output.data).toBeNull();
    expect(output.text).toBe("No invoice with number INV-1042 found.");
  });

  it("returns a public document link and caps document lines without changing totals", async () => {
    vi.mocked(documentService.find).mockResolvedValue({
      kind: "receipt", id: "rcp_1", publicId: "random_public", number: "RCP-1042", status: "PAID", currency: "NGN", clientName: "Ada",
      subtotal: "50000", total: "50000", amountPaid: "50000", taxAmount: "0", discount: "0", deliveryFee: null, dueAt: null,
      lines: Array.from({ length: 25 }, (_, index) => ({ id: `line_${index}`, name: "Wig", quantity: 1, unitPrice: "2000", total: "2000" })),
    });
    const output = await executeRead(scope, { name: "find_document", kind: "receipt", number: "RCP-1042" }, now);
    expect(output.data).toMatchObject({ total: "50000", totalLines: 25, truncated: true, url: "https://sara.test/receipts/random_public" });
    expect((output.data as Prisma.JsonObject).lines).toHaveLength(20);
  });

  it.each(["service", "product"] as const)("only shares active owned %s IDs", async (kind) => {
    const delegate = kind === "service" ? db.service : db.product;
    vi.mocked(delegate.findFirst).mockResolvedValue({ id: "item_1", name: "Braids", slug: "braids" });
    const output = await executeRead(scope, { name: "share_link", kind, id: "item_1" }, now);
    expect(delegate.findFirst).toHaveBeenCalledWith({ where: { id: "item_1", businessId: "biz_1", isActive: true }, select: { id: true, name: true, slug: true } });
    expect(output.text).toBe(`Braids: https://sara.test/${kind}s/braids`);
  });

  it.each(["service", "product"] as const)("rejects foreign or inactive %s IDs", async (kind) => {
    const delegate = kind === "service" ? db.service : db.product;
    vi.mocked(delegate.findFirst).mockResolvedValue(null);
    await expect(executeRead(scope, { name: "share_link", kind, id: "foreign" }, now)).rejects.toThrow("Active item not found");
  });

  it("asks to narrow an oversized report without slicing names, money or other facts", async () => {
    vi.mocked(customerService.list).mockResolvedValue({ data: [{ ...customer, name: "A".repeat(10000) }], total: 1 });
    const output = await executeRead(scope, { name: "find_customers", query: "A" }, now);
    expect(output.text).toBe("That report is too large for chat. Please choose one customer, item or shorter period so I can show every detail.");
    expect(output.text).not.toContain("AAA");
    expect(output.data).toMatchObject({ total: 1, truncated: false, customers: [{ id: customer.id, name: "A".repeat(10000) }] });
  });
});
