import type { Business } from "@prisma/client";
import { cache } from "react";
import type {
  BusinessClosureDto,
  BusinessHoursDto,
  BusinessProfileDto,
  ServiceDto,
} from "types";

import { db } from "@/server/db";

/** JSON round trip: the exact shape the API sends (Decimals and Dates as strings). */
function serialize<T>(value: T) {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

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
  return serialize(services) as ServiceDto[];
});

export const getBusinessHours = cache(async (businessId: string) => {
  const days = await db.businessHours.findMany({
    where: { businessId },
    orderBy: { dayOfWeek: "asc" },
  });
  return serialize(days) as BusinessHoursDto[];
});

export const getClosures = cache(async (businessId: string) => {
  const closures = await db.businessClosure.findMany({
    where: { businessId },
    orderBy: { date: "asc" },
  });
  return serialize(closures) as BusinessClosureDto[];
});
