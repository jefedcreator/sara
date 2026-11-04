import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({
  db: {
    receipt: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/backend/services/pdf", () => ({ generateReceiptPdf: vi.fn() }));
vi.mock("@/backend/services/cloudinary", () => ({ cloudinaryService: { uploadImage: vi.fn() } }));

import { cloudinaryService } from "@/backend/services/cloudinary";
import { generateReceiptPdf } from "@/backend/services/pdf";
import { db } from "@/server/db";
import { NotFoundException } from "@/utils/exceptions";
import { finalizeReceipt, receiptInclude } from "./finalize";

const mockedDb = db as any;
const DOCUMENT = {
  id: "receipt_1", publicId: "customer_link", receiptNumber: "RCP-1010",
  currency: "NGN", subtotal: 90000, taxAmount: 0, discount: 0,
  total: 90000, amountPaid: 45000, notes: "Committed notes",
  paymentMethod: "CASH", createdAt: new Date("2026-11-04T10:00:00Z"),
  name: "Ada", email: "ada@example.test", phone: null,
  business: { id: "biz_1", name: "Committed Business", email: null, phone: null, city: null, state: null, country: null, logoUrl: null },
  lines: [{ name: "Frontal wig", description: "Custom fit", quantity: 2, unitPrice: 45000, total: 90000 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.receipt.findUnique.mockResolvedValue(DOCUMENT);
  mockedDb.receipt.update.mockResolvedValue(DOCUMENT);
  vi.mocked(generateReceiptPdf).mockResolvedValue(Buffer.from("pdf"));
  vi.mocked(cloudinaryService.uploadImage).mockResolvedValue({ secure_url: "https://cdn.test/RCP-1010.pdf" } as never);
});

describe("finalizeReceipt", () => {
  it("reloads the committed document and uploads its PDF under a deterministic id", async () => {
    await finalizeReceipt("receipt_1");

    expect(mockedDb.receipt.findUnique).toHaveBeenCalledWith({ where: { id: "receipt_1" }, include: receiptInclude });
    expect(generateReceiptPdf).toHaveBeenCalledWith(expect.objectContaining({
      receiptNumber: "RCP-1010",
      notes: "Committed notes",
      business: expect.objectContaining({ name: "Committed Business" }),
      items: [{ description: "Custom fit", quantity: 2, unitPrice: "45000", total: "90000" }],
    }));
    expect(cloudinaryService.uploadImage).toHaveBeenCalledWith(Buffer.from("pdf"), {
      filename: "RCP-1010.pdf", folder: "sara/businesses/biz_1/receipts",
      mime_type: "application/pdf", public_id: "receipt_1", resource_type: "raw",
    });
    expect(mockedDb.receipt.update).toHaveBeenCalledWith({
      where: { id: "receipt_1" }, data: { url: "https://cdn.test/RCP-1010.pdf" },
    });
    expect(mockedDb.receipt.create).not.toHaveBeenCalled();
    expect(mockedDb.$transaction).not.toHaveBeenCalled();
  });

  it("leaves the document and its public link usable when generation fails", async () => {
    vi.mocked(generateReceiptPdf).mockRejectedValueOnce(new Error("renderer unavailable"));

    await expect(finalizeReceipt("receipt_1")).resolves.toBeUndefined();

    expect(cloudinaryService.uploadImage).not.toHaveBeenCalled();
    expect(mockedDb.receipt.update).not.toHaveBeenCalled();
    expect(mockedDb.receipt.create).not.toHaveBeenCalled();
  });

  it("treats upload failure as best effort without writing a URL", async () => {
    vi.mocked(cloudinaryService.uploadImage).mockRejectedValueOnce(new Error("upload unavailable"));

    await expect(finalizeReceipt("receipt_1")).resolves.toBeUndefined();

    expect(mockedDb.receipt.update).not.toHaveBeenCalled();
    expect(mockedDb.receipt.create).not.toHaveBeenCalled();
  });

  it("preserves database URL-write failures for the caller", async () => {
    mockedDb.receipt.update.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(finalizeReceipt("receipt_1")).rejects.toThrow("database unavailable");
  });

  it("does not render or create a missing document", async () => {
    mockedDb.receipt.findUnique.mockResolvedValueOnce(null);

    await expect(finalizeReceipt("missing")).rejects.toBeInstanceOf(NotFoundException);

    expect(generateReceiptPdf).not.toHaveBeenCalled();
    expect(mockedDb.receipt.create).not.toHaveBeenCalled();
  });
});
