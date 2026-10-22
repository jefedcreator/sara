import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockShelf } from "@/backend/test-utils/shelf";

import {
  activeHoldsWhere,
  availableStock,
  returnStock,
  takeStock,
} from "./stock";

const NOW = new Date("2026-10-21T12:00:00.000Z");

let tx: any;

beforeEach(() => {
  tx = {
    productOption: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    orderLine: { groupBy: vi.fn().mockResolvedValue([]) },
  };
});

describe("activeHoldsWhere", () => {
  it("only counts unpaid orders whose hold has not expired", () => {
    expect(activeHoldsWhere(NOW)).toEqual({
      status: "AWAITING_PAYMENT",
      holdExpiresAt: { gt: NOW },
    });
  });
});

describe("availableStock", () => {
  it("subtracts quantities held by unexpired checkouts", async () => {
    tx.productOption.findMany.mockResolvedValue([
      { id: "opt_1", stock: 4, product: { tracksStock: true } },
    ]);
    tx.orderLine.groupBy.mockResolvedValue([
      { productOptionId: "opt_1", _sum: { quantity: 1 } },
    ]);

    const available = await availableStock(tx, ["opt_1"], NOW);

    expect(available.get("opt_1")).toBe(3);
    expect(tx.orderLine.groupBy).toHaveBeenCalledWith({
      by: ["productOptionId"],
      where: {
        productOptionId: { in: ["opt_1"] },
        order: { status: "AWAITING_PAYMENT", holdExpiresAt: { gt: NOW } },
      },
      _sum: { quantity: true },
    });
  });

  it("ignores expired holds", async () => {
    tx.productOption.findMany.mockResolvedValue([
      { id: "opt_1", stock: 4, product: { tracksStock: true } },
    ]);
    // The query only returns live holds, so an expired one is not in the sum.
    tx.orderLine.groupBy.mockResolvedValue([]);

    const available = await availableStock(tx, ["opt_1"], NOW);

    expect(available.get("opt_1")).toBe(4);
    expect(
      tx.orderLine.groupBy.mock.calls[0]![0].where.order.holdExpiresAt,
    ).toEqual({
      gt: NOW,
    });
  });

  it("reports untracked options as null", async () => {
    tx.productOption.findMany.mockResolvedValue([
      { id: "opt_free", stock: 0, product: { tracksStock: false } },
    ]);
    tx.orderLine.groupBy.mockResolvedValue([
      { productOptionId: "opt_free", _sum: { quantity: 2 } },
    ]);

    const available = await availableStock(tx, ["opt_free"], NOW);

    expect(available.get("opt_free")).toBeNull();
  });

  it("never reports less than zero available", async () => {
    tx.productOption.findMany.mockResolvedValue([
      { id: "opt_1", stock: 1, product: { tracksStock: true } },
    ]);
    tx.orderLine.groupBy.mockResolvedValue([
      { productOptionId: "opt_1", _sum: { quantity: 3 } },
    ]);

    const available = await availableStock(tx, ["opt_1"], NOW);

    expect(available.get("opt_1")).toBe(0);
  });
});

describe("takeStock", () => {
  it("takes the quantity off the shelf", async () => {
    const shelf = mockShelf(tx.productOption, [
      { id: "opt_1", stock: 10, product: { tracksStock: true } },
    ]);

    const result = await takeStock(tx, [{ productOptionId: "opt_1", quantity: 2 }]);

    expect(result).toEqual({ short: false });
    expect(shelf.stockOf("opt_1")).toBe(8);
  });

  it("decrements only when enough is left, so a racing sale can't overwrite it", async () => {
    mockShelf(tx.productOption, [
      { id: "opt_1", stock: 10, product: { tracksStock: true } },
    ]);

    await takeStock(tx, [{ productOptionId: "opt_1", quantity: 2 }]);

    expect(tx.productOption.updateMany).toHaveBeenCalledWith({
      where: { id: "opt_1", stock: { gte: 2 } },
      data: { stock: { decrement: 2 } },
    });
  });

  it("takes stock down to zero and reports a shortfall", async () => {
    const shelf = mockShelf(tx.productOption, [
      { id: "opt_1", stock: 1, product: { tracksStock: true } },
    ]);

    const result = await takeStock(tx, [{ productOptionId: "opt_1", quantity: 2 }]);

    expect(result).toEqual({ short: true });
    expect(shelf.stockOf("opt_1")).toBe(0);
  });

  it("combines duplicate lines for the same option", async () => {
    const shelf = mockShelf(tx.productOption, [
      { id: "opt_1", stock: 3, product: { tracksStock: true } },
    ]);

    const result = await takeStock(tx, [
      { productOptionId: "opt_1", quantity: 1 },
      { productOptionId: "opt_1", quantity: 1 },
    ]);

    expect(result).toEqual({ short: false });
    expect(shelf.stockOf("opt_1")).toBe(1);
    expect(tx.productOption.updateMany).toHaveBeenCalledTimes(1);
  });

  it("takes nothing from untracked options", async () => {
    const shelf = mockShelf(tx.productOption, [
      { id: "opt_free", stock: 5, product: { tracksStock: false } },
    ]);

    const result = await takeStock(tx, [{ productOptionId: "opt_free", quantity: 2 }]);

    expect(result).toEqual({ short: false });
    expect(shelf.stockOf("opt_free")).toBe(5);
    expect(tx.productOption.updateMany).not.toHaveBeenCalled();
  });
});

describe("returnStock", () => {
  it("puts stock back on tracked options only", async () => {
    tx.productOption.findMany.mockResolvedValue([
      { id: "opt_1", product: { tracksStock: true } },
      { id: "opt_free", product: { tracksStock: false } },
    ]);

    await returnStock(tx, [
      { productOptionId: "opt_1", quantity: 1 },
      { productOptionId: "opt_1", quantity: 1 },
      { productOptionId: "opt_free", quantity: 3 },
    ]);

    expect(tx.productOption.update).toHaveBeenCalledTimes(1);
    expect(tx.productOption.update).toHaveBeenCalledWith({
      where: { id: "opt_1" },
      data: { stock: { increment: 2 } },
    });
  });
});
