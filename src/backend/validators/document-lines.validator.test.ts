import { describe, expect, it } from "vitest";

import { invoiceItemValidatorSchema } from "./invoice.validator";
import { receiptItemValidatorSchema } from "./receipt.validator";

const OPTION_ID = "clx0productoption000001";

describe("document line validators", () => {
  it("accept a product option line without a name", () => {
    const line = {
      productOptionId: OPTION_ID,
      quantity: 1,
      unitPrice: 45000,
      total: 45000,
    };

    expect(invoiceItemValidatorSchema.parse(line)).toMatchObject({
      productOptionId: OPTION_ID,
      quantity: 1,
    });
    expect(receiptItemValidatorSchema.parse(line)).toMatchObject({
      productOptionId: OPTION_ID,
      quantity: 1,
    });
  });

  it("accept a custom line with only a name", () => {
    const line = { name: "Delivery", quantity: 1, unitPrice: 3000, total: 3000 };

    expect(invoiceItemValidatorSchema.parse(line)).toMatchObject({
      name: "Delivery",
    });
    expect(receiptItemValidatorSchema.parse(line)).toMatchObject({
      name: "Delivery",
    });
  });

  it("reject a line with no service, product option or name", () => {
    const line = { quantity: 1, unitPrice: 1, total: 1 };

    expect(invoiceItemValidatorSchema.safeParse(line).success).toBe(false);
    expect(receiptItemValidatorSchema.safeParse(line).success).toBe(false);
  });
});
