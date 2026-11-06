import type { Prisma } from "@prisma/client";

import { BadRequestException, NotFoundException } from "@/utils/exceptions";

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
 * Assert that all requested lines are available right now. Duplicates are
 * summed, options must belong to products owned by the business and be active,
 * and tracked products must have sufficient available stock (taking active holds
 * into account).
 */
export async function requireAvailableStock(
  tx: Prisma.TransactionClient,
  businessId: string,
  lines: StockLine[],
  now: Date,
): Promise<void> {
  const quantities = combineLines(lines);
  if (quantities.size === 0) return;

  const optionIds = [...quantities.keys()];
  const options = await tx.productOption.findMany({
    where: { id: { in: optionIds } },
    select: {
      id: true,
      stock: true,
      isActive: true,
      product: {
        select: {
          id: true,
          businessId: true,
          tracksStock: true,
          isActive: true,
        },
      },
    },
  });

  const optionsById = new Map(options.map((option) => [option.id, option]));

  for (const optionId of optionIds) {
    const option = optionsById.get(optionId);
    if (option?.product.businessId !== businessId) {
      throw new NotFoundException("Product option not found");
    }
    if (option.isActive === false || option.product.isActive === false) {
      throw new BadRequestException("Product option is inactive");
    }
  }

  const trackedOptionIds = options
    .filter((option) => option.product.tracksStock)
    .map((option) => option.id);

  if (trackedOptionIds.length > 0) {
    const available = await availableStock(tx, trackedOptionIds, now);
    for (const optionId of trackedOptionIds) {
      const left = available.get(optionId);
      const requested = quantities.get(optionId) ?? 0;
      if (left !== null && left !== undefined && left < requested) {
        throw new BadRequestException(
          `Not enough stock available for option ${optionId}`,
        );
      }
    }
  }
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
