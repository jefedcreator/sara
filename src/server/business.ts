import type { Business } from "@prisma/client";
import { cache } from "react";
import type { BusinessProfileDto } from "@/types";

import { db } from "@/server/db";

/**
 * The business as the client may see it. Bank details, the Paystack code and
 * Google tokens stay on the server; the client gets yes/no flags instead.
 */
export function toBusinessProfile(business: Business): BusinessProfileDto {
  return {
    id: business.id,
    name: business.name,
    slug: business.slug,
    description: business.description,
    phone: business.phone,
    email: business.email,
    address: business.address,
    city: business.city,
    state: business.state,
    currency: business.currency,
    sells: business.sells,
    offersDelivery: business.offersDelivery,
    deliveryFee:
      business.deliveryFee === null ? null : Number(business.deliveryFee),
    offersPickup: business.offersPickup,
    settlementAccountName: business.settlementAccountName,
    isPaymentReady: Boolean(business.paystackSubaccountCode),
    calendarConnectedAt:
      business.googleCalendarRefreshToken && business.googleCalendarConnectedAt
        ? business.googleCalendarConnectedAt.toISOString()
        : null,
  };
}

export const getServices = cache(async (businessId: string) => {
  const services = await db.service.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
  });
  return services;
});

export const getProducts = cache(async (businessId: string) => {
  const products = await db.product.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    include: {
      options: {
        where: { isActive: true },
        orderBy: { position: "asc" },
      },
    },
  });
  return products;
});

export const getBusinessHours = cache(async (businessId: string) => {
  const days = await db.businessHours.findMany({
    where: { businessId },
    orderBy: { dayOfWeek: "asc" },
  });
  return days;
});

export const getClosures = cache(async (businessId: string) => {
  const closures = await db.businessClosure.findMany({
    where: { businessId },
    orderBy: { date: "asc" },
  });
  return closures;
});
