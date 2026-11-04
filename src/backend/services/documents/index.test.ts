import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ db: {
  invoice: { findFirst: vi.fn() }, receipt: { findFirst: vi.fn() }, order: { findFirst: vi.fn() },
} }));

import { db } from "@/server/db";
import { documentService } from "./index";

const base = {
  id: "doc_1", publicId: "public_1", currency: "NGN", subtotal: new Prisma.Decimal("45000.25"),
  total: new Prisma.Decimal("45000.25"), amountPaid: new Prisma.Decimal("10000"), taxAmount: new Prisma.Decimal(0), discount: new Prisma.Decimal(0),
  lines: [{ id: "line_1", name: "Braids", quantity: 1, unitPrice: new Prisma.Decimal("45000.25"), total: new Prisma.Decimal("45000.25") }],
};

beforeEach(() => vi.resetAllMocks());

describe("documentService.find", () => {
  it("looks up a document within the trusted business", async () => {
    vi.mocked(db.invoice.findFirst).mockResolvedValue(null);
    expect(await documentService.find("biz_a", "invoice", "INV-1042")).toBeNull();
    expect(db.invoice.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { businessId: "biz_a", invoiceNumber: "INV-1042" } }));
  });

  it("serializes invoice money and due dates deliberately, with ordered lines", async () => {
    vi.mocked(db.invoice.findFirst).mockResolvedValue({ ...base, invoiceNumber: "INV-1042", status: "SENT", clientName: "Ada", dueAt: new Date("2026-11-05T10:00:00Z") } as never);
    const found = await documentService.find("biz_a", "invoice", "INV-1042");
    expect(found).toMatchObject({ kind: "invoice", id: "doc_1", publicId: "public_1", number: "INV-1042", status: "SENT", total: "45000.25", amountPaid: "10000", dueAt: "2026-11-05T10:00:00.000Z", lines: [{ unitPrice: "45000.25", total: "45000.25" }] });
    expect(db.invoice.findFirst).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ lines: expect.objectContaining({ orderBy: { position: "asc" } }) }) }));
    expect(found).not.toHaveProperty("business");
  });

  it("looks up a receipt by its own number and represents its paid status", async () => {
    vi.mocked(db.receipt.findFirst).mockResolvedValue({ ...base, receiptNumber: "RCP-1042", name: "Ada" } as never);
    expect(await documentService.find("biz_a", "receipt", "RCP-1042")).toMatchObject({ kind: "receipt", number: "RCP-1042", status: "PAID", clientName: "Ada" });
    expect(db.receipt.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { businessId: "biz_a", receiptNumber: "RCP-1042" } }));
    expect(db.invoice.findFirst).not.toHaveBeenCalled();
  });

  it("uses order fields without inventing invoice amounts or line positions", async () => {
    vi.mocked(db.order.findFirst).mockResolvedValue({ ...base, orderNumber: "ORD-1042", status: "READY", clientName: "Ada", deliveryFee: new Prisma.Decimal("2500") } as never);
    expect(await documentService.find("biz_a", "order", "ORD-1042")).toMatchObject({ kind: "order", number: "ORD-1042", status: "READY", amountPaid: null, taxAmount: null, deliveryFee: "2500" });
    expect(db.order.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { businessId: "biz_a", orderNumber: "ORD-1042" }, select: expect.objectContaining({ lines: expect.objectContaining({ orderBy: { id: "asc" } }) }) }));
  });

  it.each(["receipt", "order"] as const)("returns null for a foreign or missing %s number", async (kind) => {
    vi.mocked(db.receipt.findFirst).mockResolvedValue(null);
    vi.mocked(db.order.findFirst).mockResolvedValue(null);
    expect(await documentService.find("biz_a", kind, "1042")).toBeNull();
  });
});
