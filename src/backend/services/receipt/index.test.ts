import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => {
  const db: any = {
    receipt: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    payment: { findFirst: vi.fn() },
    service: { findMany: vi.fn() },
    business: { findUnique: vi.fn() },
  };
  db.$transaction = vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db));
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

import { db } from "@/server/db";
import { receiptService } from "./index";

const mockedDb = db as any;
const BUSINESS = { id: "biz_1", name: "Acme Salon", email: null, phone: null, city: null, state: null, country: null, logoUrl: null };

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.business.findUnique.mockResolvedValue(BUSINESS);
  mockedDb.receipt.findFirst.mockResolvedValue(null);
  mockedDb.service.findMany.mockResolvedValue([]);
  mockedDb.receipt.create.mockResolvedValue({
    id: "rcp_1", slug: "acme-salon-rcp-1001", receiptNumber: "RCP-1001",
    business: BUSINESS, services: [], currency: "NGN", subtotal: 5000, taxAmount: 0,
    discount: 0, total: 5000, amountPaid: 5000, paymentMethod: null, notes: "gele",
    name: "Ada", email: null, phone: null, createdAt: new Date(),
  });
  mockedDb.receipt.update.mockResolvedValue({
    id: "rcp_1", slug: "acme-salon-rcp-1001", receiptNumber: "RCP-1001",
    url: "https://cdn.test/RCP-1001.pdf",
  });
});

describe("receiptService.create", () => {
  it("creates the first receipt as RCP-1001 and returns the record with a url", async () => {
    const result = await receiptService.create({
      businessId: "biz_1", name: "Ada", currency: "NGN",
      subtotal: 5000, taxAmount: 0, discount: 0, total: 5000, amountPaid: 5000, notes: "gele",
    });
    expect(mockedDb.receipt.create.mock.calls[0]![0].data.receiptNumber).toBe("RCP-1001");
    expect(result.url).toBe("https://cdn.test/RCP-1001.pdf");
  });
});
