import type { Prisma } from "@prisma/client";

/** One option and how many of it an order wants. */
export type StockLine = { productOptionId: string; quantity: number };

/**
 * Orders that still hold their stock: an online checkout that is waiting for
 * payment and whose hold has not expired. An expired hold simply stops
 * counting, so no cron job is needed.
 */
export function activeHoldsWhere(now: Date): Prisma.OrderWhereInput {
  return { status: "AWAITING_PAYMENT", holdExpiresAt: { gt: now } };
}

/** Sum the quantities of lines that point at the same option. */
function combineLines(lines: StockLine[]): Map<string, number> {
  const quantities = new Map<string, number>();

  for (const line of lines) {
    if (line.quantity <= 0) continue;
    quantities.set(
      line.productOptionId,
      (quantities.get(line.productOptionId) ?? 0) + line.quantity,
    );
  }

  return quantities;
}

/**
 * What a customer can buy right now: stock minus the quantities held by live
 * checkouts. A null value means the option's product doesn't track stock, so
 * it is always available.
 */
export async function availableStock(
  client: Prisma.TransactionClient,
  optionIds: string[],
  now: Date,
): Promise<Map<string, number | null>> {
  const available = new Map<string, number | null>();
  const ids = [...new Set(optionIds)];

  if (ids.length === 0) return available;

  const [options, held] = await Promise.all([
    client.productOption.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        stock: true,
        product: { select: { tracksStock: true } },
      },
    }),
    client.orderLine.groupBy({
      by: ["productOptionId"],
      where: {
        productOptionId: { in: ids },
        order: activeHoldsWhere(now),
      },
      _sum: { quantity: true },
    }),
  ]);

  const heldByOption = new Map<string, number>();
  for (const row of held) {
    if (row.productOptionId) {
      heldByOption.set(row.productOptionId, row._sum.quantity ?? 0);
    }
  }

  for (const option of options) {
    available.set(
      option.id,
      option.product.tracksStock
        ? Math.max(option.stock - (heldByOption.get(option.id) ?? 0), 0)
        : null,
    );
  }

  return available;
}

/**
 * Take the lines out of stock. Stock never goes below zero; if an order wants
 * more than is left, take what remains and report the shortfall. Products that
 * don't track stock are left alone. Must run inside the caller's transaction.
 */
export async function takeStock(
  client: Prisma.TransactionClient,
  lines: StockLine[],
): Promise<{ short: boolean }> {
  const quantities = combineLines(lines);
  if (quantities.size === 0) return { short: false };

  const options = await client.productOption.findMany({
    where: { id: { in: [...quantities.keys()] } },
    select: {
      id: true,
      product: { select: { tracksStock: true } },
    },
  });

  let short = false;

  for (const option of options) {
    if (!option.product.tracksStock) continue;

    const quantity = quantities.get(option.id) ?? 0;

    // A conditional decrement is atomic in the database whatever the caller's
    // isolation level, so a receipt sale and an online payment landing
    // together can't both read the same count and overwrite each other.
    const enough: Prisma.ProductOptionWhereInput = {
      id: option.id,
      stock: { gte: quantity },
    };
    const taken = await client.productOption.updateMany({
      where: enough,
      data: { stock: { decrement: quantity } },
    });

    if (taken.count === 0) {
      // Not enough left: take what remains and report the shortfall.
      short = true;
      await client.productOption.update({
        where: { id: option.id },
        data: { stock: 0 },
      });
    }
  }

  return { short };
}

/**
 * Put the lines back, for a cancelled order. Only options whose product tracks
 * stock change. Must run inside the caller's transaction.
 */
export async function returnStock(
  client: Prisma.TransactionClient,
  lines: StockLine[],
): Promise<void> {
  const quantities = combineLines(lines);
  if (quantities.size === 0) return;

  const options = await client.productOption.findMany({
    where: { id: { in: [...quantities.keys()] } },
    select: {
      id: true,
      product: { select: { tracksStock: true } },
    },
  });

  for (const option of options) {
    if (!option.product.tracksStock) continue;

    await client.productOption.update({
      where: { id: option.id },
      data: { stock: { increment: quantities.get(option.id) ?? 0 } },
    });
  }
}
