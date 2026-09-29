import { describe, expect, it } from "vitest";

import type { DocumentFormSchema } from "@/backend/validators/document-form.validator";

import { computeTotals, toDocumentPayload } from "./documents";

const base: DocumentFormSchema = {
  name: "Ada",
  email: "",
  phone: "",
  mode: "services",
  items: [],
  amount: "",
  description: "",
  taxAmount: "",
  discount: "",
  dueAt: "",
  paymentMethod: "CASH",
};

describe("computeTotals", () => {
  it("adds line items, tax and discount", () => {
    expect(
      computeTotals({
        ...base,
        items: [
          { serviceId: "s1", quantity: "2", unitPrice: "12,500" },
          { serviceId: "s2", quantity: "1", unitPrice: "5000" },
        ],
        taxAmount: "2250",
        discount: "1,000",
      }),
    ).toEqual({ subtotal: 30000, taxAmount: 2250, discount: 1000, total: 31250 });
  });

  it("uses the custom amount in amount mode and ignores items", () => {
    expect(
      computeTotals({
        ...base,
        mode: "amount",
        amount: "15000",
        items: [{ serviceId: "s1", quantity: "1", unitPrice: "99" }],
      }),
    ).toEqual({ subtotal: 15000, taxAmount: 0, discount: 0, total: 15000 });
  });

  it("never goes below zero and skips half-filled rows", () => {
    expect(
      computeTotals({
        ...base,
        items: [
          { serviceId: "s1", quantity: "1", unitPrice: "1000" },
          { serviceId: "", quantity: "1", unitPrice: "500" },
        ],
        discount: "5000",
      }).total,
    ).toBe(0);
  });
});

describe("toDocumentPayload", () => {
  it("drops empty optional fields and carries line items", () => {
    const payload = toDocumentPayload(
      { ...base, items: [{ serviceId: "s1", quantity: "1", unitPrice: "25000" }] },
      "NGN",
    );
    expect(payload).toEqual({
      name: "Ada",
      email: undefined,
      phone: undefined,
      currency: "NGN",
      subtotal: 25000,
      taxAmount: 0,
      discount: 0,
      total: 25000,
      notes: undefined,
      services: [{ serviceId: "s1", quantity: 1, unitPrice: 25000, total: 25000 }],
    });
  });

  it("puts a custom amount's description in the notes, with no items", () => {
    const payload = toDocumentPayload(
      { ...base, mode: "amount", amount: "15000", description: "Wig install" },
      "NGN",
    );
    expect(payload.services).toBeUndefined();
    expect(payload.notes).toBe("Wig install");
    expect(payload.total).toBe(15000);
  });
});
