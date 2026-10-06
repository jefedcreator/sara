import { cache } from "react";

import { db } from "@/server/db";
import type { ServicePage } from "@/utils/service-page";

const summary = {
  slug: true,
  name: true,
  image: true,
  price: true,
  duration: true,
  bookingMode: true,
} as const;

/**
 * A live service as its public page shows it, with up to six of the
 * business's other live services; null for an unknown slug or a paused
 * service. No availability work: picking a time is /book's job.
 */
export const getServicePage = cache(
  async (slug: string): Promise<ServicePage | null> => {
    const service = await db.service.findFirst({
      where: { slug, isActive: true },
      select: {
        ...summary,
        id: true,
        businessId: true,
        description: true,
        checkInTime: true,
        checkOutTime: true,
        minUnits: true,
        maxUnits: true,
        business: { select: { name: true, currency: true } },
      },
    });
    if (!service) return null;

    const others = await db.service.findMany({
      where: { businessId: service.businessId, isActive: true, id: { not: service.id } },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: summary,
    });

    return {
      slug: service.slug,
      name: service.name,
      image: service.image,
      price: service.price.toString(),
      duration: service.duration,
      bookingMode: service.bookingMode,
      description: service.description,
      currency: service.business.currency,
      checkInTime: service.checkInTime,
      checkOutTime: service.checkOutTime,
      minUnits: service.minUnits,
      maxUnits: service.maxUnits,
      businessName: service.business.name,
      others: others.map((other) => ({ ...other, price: other.price.toString() })),
    };
  },
);
