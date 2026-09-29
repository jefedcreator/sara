import { describe, expect, it } from "vitest";

import { updateBusinessValidatorSchema } from "./business.validator";
import { updateInvoiceValidatorSchema } from "./invoice.validator";
import { updateReceiptValidatorSchema } from "./receipt.validator";
import { updateServiceValidatorSchema } from "./service.validator";

// An update must carry only what was sent. Zod 4 keeps `.default()`s through
// `.partial()`, which silently reset fields on every edit.
describe("update schemas add no defaults", () => {
  it("invoice: recording a payment changes nothing else", () => {
    expect(
      updateInvoiceValidatorSchema.parse({ status: "PAID", amountPaid: 30000 }),
    ).toEqual({ status: "PAID", amountPaid: 30000 });
  });

  it("invoice: a rename keeps status, currency and money fields", () => {
    expect(updateInvoiceValidatorSchema.parse({ name: "Ada" })).toEqual({ name: "Ada" });
  });

  it("receipt: a rename keeps currency and money fields", () => {
    expect(updateReceiptValidatorSchema.parse({ name: "Ada" })).toEqual({ name: "Ada" });
  });

  it("business: a profile edit keeps the currency", () => {
    expect(updateBusinessValidatorSchema.parse({ name: "Tobi Beauty" })).toEqual({
      name: "Tobi Beauty",
    });
  });

  it("service: pausing keeps its hours", () => {
    expect(updateServiceValidatorSchema.parse({ isActive: false })).toEqual({
      isActive: false,
    });
  });

  it("still validates what is sent", () => {
    expect(updateInvoiceValidatorSchema.safeParse({ status: "NOPE" }).success).toBe(false);
    expect(
      updateServiceValidatorSchema.safeParse({ availableFrom: "18:00", availableTo: "09:00" })
        .success,
    ).toBe(false);
  });
});
