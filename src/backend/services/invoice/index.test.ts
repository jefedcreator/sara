import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => {
  const db: any = {
    invoice: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    booking: { findFirst: vi.fn() },
    service: { findMany: vi.fn() },
    business: { findUnique: vi.fn() },
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
import { invoiceService } from "./index";

const mockedDb = db as any;
const BUSINESS = { id: "biz_1", name: "Acme Salon", email: null, phone: null, city: null, state: null, country: null, logoUrl: null };

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.business.findUnique.mockResolvedValue(BUSINESS);
  mockedDb.invoice.findFirst.mockResolvedValue(null);
  mockedDb.invoice.findUnique.mockResolvedValue(null);
  mockedDb.service.findMany.mockResolvedValue([]);
  mockedDb.invoice.create.mockResolvedValue({
    id: "inv_1", slug: "acme-salon-inv-1001", invoiceNumber: "INV-1001",
    business: BUSINESS, services: [], subtotal: 5000, taxAmount: 0, discount: 0,
    total: 5000, amountPaid: 0, currency: "NGN", status: "SENT",
    dueAt: null, sentAt: null, paidAt: null, notes: "eggs",
    clientName: "Ada", clientEmail: null, clientPhone: null,
  });
  mockedDb.invoice.update.mockResolvedValue({
    id: "inv_1", slug: "acme-salon-inv-1001", invoiceNumber: "INV-1001",
    url: "https://cdn.test/INV-1001.pdf",
  });
});

describe("invoiceService.create", () => {
  it("creates the first invoice as INV-1001 and returns the record with a url", async () => {
    const result = await invoiceService.create({
      businessId: "biz_1", name: "Ada", status: "SENT", currency: "NGN",
      subtotal: 5000, taxAmount: 0, discount: 0, total: 5000, amountPaid: 0, notes: "eggs",
    });
    expect(mockedDb.invoice.create.mock.calls[0]![0].data.invoiceNumber).toBe("INV-1001");
    expect(result.url).toBe("https://cdn.test/INV-1001.pdf");
  });
});
