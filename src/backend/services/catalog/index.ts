import { availabilityService } from "@/backend/services/availability";
import { db } from "@/server/db";

/** What a customer may see about a service on its booking page. */
export type PublicService = {
  slug: string;
  name: string;
  description: string | null;
  image: string | null;
  price: string;
  duration: number;
  currency: string;
  businessName: string;
  slots: { startTime: string; endTime: string; isAvailable: boolean }[];
};

class CatalogService {
  /**
   * An active service with its slots for `date` (YYYY-MM-DD), or null when
   * the slug is unknown or the service is paused. Owner-only fields never
   * leave this function.
   */
  async getPublicService(slug: string, date: string): Promise<PublicService | null> {
    const service = await db.service.findFirst({
      where: { slug, isActive: true },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        image: true,
        price: true,
        duration: true,
        businessId: true,
        business: { select: { name: true, currency: true } },
      },
    });

    if (!service) return null;

    const availableSlots = await availabilityService.getAvailableSlots({
      businessId: service.businessId,
      serviceId: service.id,
      date,
    });

    return {
      slug: service.slug,
      name: service.name,
      description: service.description,
      image: service.image,
      price: service.price.toString(),
      duration: service.duration,
      currency: service.business.currency,
      businessName: service.business.name,
      slots: availableSlots.map((slot) => ({
        startTime: slot.startTime.toISOString(),
        endTime: slot.endTime.toISOString(),
        isAvailable: slot.isAvailable,
      })),
    };
  }
}

export const catalogService = new CatalogService();
