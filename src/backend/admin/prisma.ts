import { Prisma } from "@prisma/client";

// The kit's only route to this product's Prisma client. Every file in `kit/`
// imports `Prisma` and `jsonNull` from here, so the kit stays identical in
// every product.
export { Prisma };

/**
 * What the kit writes for `null` on a nullable JSON field (spec §6.4). Sara is
 * on PostgreSQL, where JSON `null` is `Prisma.DbNull`.
 */
export const jsonNull = Prisma.DbNull;
