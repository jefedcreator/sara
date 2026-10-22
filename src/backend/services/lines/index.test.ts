import { describe, expect, it, vi } from "vitest";

import { BadRequestException } from "@/utils/exceptions";

import { resolveDocumentLines } from "./index";

function txWithServices(services: { id: string; name: string }[]) {
  return {
    service: { findMany: vi.fn().mockResolvedValue(services) },
    productOption: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

type ProductOptionRow = {
  id: string;
  name: string;
  isActive?: boolean;
  product: { name: string; businessId: string; isActive?: boolean };
};

/**
 * The active options come back on the first query; anything still missing is
 * looked up again (without the activity filter) to decide between "another
 * business" and "no longer available".
 */
function txWithProductOptions(
  active: ProductOptionRow[],
  inactive: ProductOptionRow[] = [],
) {
  return {
    service: { findMany: vi.fn().mockResolvedValue([]) },
    productOption: {
      findMany: vi.fn().mockImplementation((args: any) => {
        if (args?.select) return Promise.resolve(inactive);
        return Promise.resolve(active);
      }),
    },
  };
}

describe("resolveDocumentLines", () => {
  it("fills the name from the service and numbers the lines", async () => {
    const tx = txWithServices([{ id: "svc_1", name: "Knotless braids" }]);
    const lines = await resolveDocumentLines(tx as any, "biz_1", [
      { serviceId: "svc_1", quantity: 2, unitPrice: 25000, total: 50000 },
    ]);
    expect(lines).toEqual([
      {
        serviceId: "svc_1",
        productOptionId: null,
        name: "Knotless braids",
        description: null,
        quantity: 2,
        unitPrice: 25000,
        total: 50000,
        position: 0,
      },
    ]);
    expect(tx.service.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["svc_1"] }, businessId: "biz_1" },
      }),
    );
  });

  it("rejects a service from another business", async () => {
    const tx = txWithServices([]);
    await expect(
      resolveDocumentLines(tx as any, "biz_1", [
        { serviceId: "svc_x", quantity: 1, unitPrice: 1, total: 1 },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("keeps a named line that has no service", async () => {
    const tx = txWithServices([]);
    const [line] = await resolveDocumentLines(tx as any, "biz_1", [
      { name: "Delivery", quantity: 1, unitPrice: 3000, total: 3000 },
    ]);
    expect(line).toMatchObject({
      serviceId: null,
      productOptionId: null,
      name: "Delivery",
    });
  });

  it("rejects a line with neither a service nor a name", async () => {
    const tx = txWithServices([]);
    await expect(
      resolveDocumentLines(tx as any, "biz_1", [
        { quantity: 1, unitPrice: 1, total: 1 },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("names a product line after its product and option", async () => {
    const tx = txWithProductOptions([
      {
        id: "opt_1",
        name: '20"',
        product: { name: "Frontal wig", businessId: "biz_1" },
      },
    ]);
    const [line] = await resolveDocumentLines(tx as any, "biz_1", [
      { productOptionId: "opt_1", quantity: 1, unitPrice: 45000, total: 45000 },
    ]);
    expect(line).toEqual({
      serviceId: null,
      productOptionId: "opt_1",
      name: 'Frontal wig — 20"',
      description: null,
      quantity: 1,
      unitPrice: 45000,
      total: 45000,
      position: 0,
    });
    expect(tx.productOption.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["opt_1"] },
        isActive: true,
        product: { businessId: "biz_1", isActive: true },
      },
      include: { product: { select: { name: true } } },
    });
  });

  it("rejects an option from another business", async () => {
    const tx = txWithProductOptions([]);
    await expect(
      resolveDocumentLines(tx as any, "biz_1", [
        { productOptionId: "opt_x", quantity: 1, unitPrice: 1, total: 1 },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects an inactive option", async () => {
    const tx = txWithProductOptions([], [
      {
        id: "opt_1",
        name: '20"',
        isActive: false,
        product: { name: "Frontal wig", businessId: "biz_1" },
      },
    ]);
    await expect(
      resolveDocumentLines(tx as any, "biz_1", [
        { productOptionId: "opt_1", quantity: 1, unitPrice: 1, total: 1 },
      ]),
    ).rejects.toThrow("This product is no longer available");
  });

  it("rejects an option whose product is inactive", async () => {
    const tx = txWithProductOptions([], [
      {
        id: "opt_1",
        name: '20"',
        product: { name: "Frontal wig", businessId: "biz_1", isActive: false },
      },
    ]);
    await expect(
      resolveDocumentLines(tx as any, "biz_1", [
        { productOptionId: "opt_1", quantity: 1, unitPrice: 1, total: 1 },
      ]),
    ).rejects.toThrow("This product is no longer available");
  });

  it("rejects a line with both a service and a product option", async () => {
    const tx = txWithProductOptions([]);
    await expect(
      resolveDocumentLines(tx as any, "biz_1", [
        {
          serviceId: "svc_1",
          productOptionId: "opt_1",
          quantity: 1,
          unitPrice: 1,
          total: 1,
        },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
