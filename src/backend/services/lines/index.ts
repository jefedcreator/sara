import { optionLabel } from "@/backend/services/product/labels";
import type { Prisma } from "@prisma/client";

import { BadRequestException } from "@/utils/exceptions";

/** A line as the API and the chat send it: a service, a product option, or a typed name for a custom line. */
export type DocumentLineInput = {
  serviceId?: string | null;
  productOptionId?: string | null;
  name?: string;
  description?: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
};

/** A line ready to write, with the service's or product option's name filled in and its position. */
export type ResolvedLine = {
  serviceId: string | null;
  productOptionId: string | null;
  name: string;
  description: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
  position: number;
};

/**
 * Turn requested lines into database lines: fill each service line's name from
 * the business's own service and each product line's name from its product and
 * option (so a deleted service or paused product keeps the line readable),
 * keep a typed name for custom lines, and number them in the order given.
 * Throws for a service or product option from another business, a line with
 * both a service and a product option, an unavailable product, or a line with
 * no service, product option or name.
 */
export async function resolveDocumentLines(
  client: Prisma.TransactionClient,
  businessId: string,
  lines: DocumentLineInput[],
): Promise<ResolvedLine[]> {
  for (const line of lines) {
    if (line.serviceId && line.productOptionId) {
      throw new BadRequestException(
        "A line cannot have both a service and a product option",
      );
    }
  }

  const serviceIds = Array.from(
    new Set(
      lines
        .map((line) => line.serviceId)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const productOptionIds = Array.from(
    new Set(
      lines
        .map((line) => line.productOptionId)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const services =
    serviceIds.length > 0
      ? await client.service.findMany({
          where: { id: { in: serviceIds }, businessId },
          select: { id: true, name: true },
        })
      : [];

  if (services.length !== serviceIds.length) {
    throw new BadRequestException(
      "One or more invoice item services do not belong to this business",
    );
  }

  const productOptions =
    productOptionIds.length > 0
      ? await client.productOption.findMany({
          where: {
            id: { in: productOptionIds },
            isActive: true,
            product: { businessId, isActive: true },
          },
          include: { product: { select: { name: true } } },
        })
      : [];

  if (productOptions.length !== productOptionIds.length) {
    const foundIds = new Set(productOptions.map((option) => option.id));
    const missingIds = productOptionIds.filter((id) => !foundIds.has(id));
    // The active-only query above hides whether a missing option belongs to
    // another business or was paused. Look again without the activity filter
    // (but still scoped to this business) to tell the two apart.
    const unavailableOptions = await client.productOption.findMany({
      where: { id: { in: missingIds }, product: { businessId } },
      select: { id: true, isActive: true, product: { select: { isActive: true } } },
    });

    if (unavailableOptions.length !== missingIds.length) {
      throw new BadRequestException(
        "One or more invoice item products do not belong to this business",
      );
    }

    throw new BadRequestException("This product is no longer available");
  }

  const nameByServiceId = new Map(
    services.map((service) => [service.id, service.name]),
  );

  const nameByProductOptionId = new Map(
    productOptions.map((option) => [
      option.id,
      optionLabel(option.product.name, option.name),
    ]),
  );

  return lines.map((line, position) => {
    const name =
      (line.serviceId ? nameByServiceId.get(line.serviceId) : undefined) ??
      (line.productOptionId
        ? nameByProductOptionId.get(line.productOptionId)
        : undefined) ??
      line.name?.trim();
    if (!name) {
      throw new BadRequestException(
        "Each line needs a service, a product option or a name",
      );
    }

    return {
      serviceId: line.serviceId ?? null,
      productOptionId: line.productOptionId ?? null,
      name,
      description: line.description ?? null,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      total: line.total,
      position,
    };
  });
}
