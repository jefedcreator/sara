import type { PublicServiceDto } from "types";

import { availabilityService } from "@/backend/services/availability";
import { db } from "@/server/db";
import { monthStart, nightsWindow } from "@/utils/format";

export type PublicService = PublicServiceDto;

export type PublicServiceQuery = {
  /** SLOT: the day. DAILY: the pickup day. NIGHTLY: picks the default month. */
  date: string;
  /** NIGHTLY window, [from, to). */
  from?: string;
  to?: string;
  /** DAILY: rental length; defaults to the minimum. */
  units?: number;
};

const iso = (d: Date) => d.toISOString();

class CatalogService {
  /**
   * An active service with the availability its mode needs, or null when the
   * slug is unknown or the service is paused. Owner-only fields never leave
   * this function.
   */
  async getPublicService(slug: string, query: PublicServiceQuery): Promise<PublicService | null> {
    const service = await db.service.findFirst({
      where: { slug, isActive: true },
      select: {
        id: true, slug: true, name: true, description: true, image: true, price: true, duration: true,
        businessId: true, bookingMode: true, checkInTime: true, checkOutTime: true, minUnits: true, maxUnits: true,
        business: { select: { name: true, currency: true } },
      },
    });
    if (!service) return null;

    const base = {
      slug: service.slug,
      name: service.name,
      description: service.description,
      image: service.image,
      price: service.price.toString(),
      duration: service.duration,
      currency: service.business.currency,
      businessName: service.business.name,
      bookingMode: service.bookingMode,
      checkInTime: service.checkInTime,
      checkOutTime: service.checkOutTime,
      minUnits: service.minUnits,
      maxUnits: service.maxUnits,
    };

    if (service.bookingMode === "NIGHTLY") {
      const window =
        query.from && query.to
          ? { from: query.from, to: query.to }
          : nightsWindow(monthStart(query.date), service.maxUnits);
      const nights = await availabilityService.getNights({ serviceId: service.id, ...window });
      return { ...base, slots: [], nights };
    }

    const slots =
      service.bookingMode === "DAILY"
        ? await availabilityService.getPickupTimes({
            serviceId: service.id,
            date: query.date,
            units: query.units ?? service.minUnits,
          })
        : await availabilityService.getAvailableSlots({
            businessId: service.businessId,
            serviceId: service.id,
            date: query.date,
          });

    return {
      ...base,
      slots: slots.map((s) => ({ startTime: iso(s.startTime), endTime: iso(s.endTime), isAvailable: s.isAvailable })),
      nights: [],
    };
  }
}

export const catalogService = new CatalogService();
