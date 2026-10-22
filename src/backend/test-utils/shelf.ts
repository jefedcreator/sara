import type { Mock } from "vitest";

type ShelfRow = { id: string; stock: number; product: { tracksStock: boolean } };

type ProductOptionMock = { findMany: Mock; updateMany: Mock; update: Mock };

type StockWhere = { id: string; stock: { gte: number } };
type StockData = { stock: number | { increment: number } | { decrement: number } };

/**
 * A fake shelf for a mocked `productOption`: findMany, the conditional
 * updateMany decrement and update all read and write one in-memory stock
 * count, so stock tests assert what is left rather than the exact Prisma calls.
 */
export function mockShelf(productOption: ProductOptionMock, rows: ShelfRow[]) {
  const shelf = new Map(rows.map((row) => [row.id, { ...row }]));

  productOption.findMany.mockImplementation(
    async ({ where }: { where?: { id?: { in?: string[] } } } = {}) =>
      [...shelf.values()]
        .filter((row) => !where?.id?.in || where.id.in.includes(row.id))
        .map((row) => ({ ...row })),
  );

  productOption.updateMany.mockImplementation(
    async ({ where, data }: { where: StockWhere; data: StockData }) => {
      const row = shelf.get(where.id);
      if (!row || row.stock < where.stock.gte) return { count: 0 };
      if (typeof data.stock === "object" && "decrement" in data.stock) {
        row.stock -= data.stock.decrement;
      }
      return { count: 1 };
    },
  );

  productOption.update.mockImplementation(
    async ({ where, data }: { where: { id: string }; data: StockData }) => {
      const row = shelf.get(where.id);
      if (!row) throw new Error(`No option ${where.id} on the shelf`);
      if (typeof data.stock === "number") row.stock = data.stock;
      else if ("increment" in data.stock) row.stock += data.stock.increment;
      return { ...row };
    },
  );

  return { stockOf: (id: string) => shelf.get(id)?.stock };
}
