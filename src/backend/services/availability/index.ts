import { getPickupTimes } from "./daily";
import { getNights, type NightAvailability } from "./nightly";
import { getSlotAvailability, type AvailabilitySlot } from "./slot";

export type { AvailabilitySlot, NightAvailability };

/** Free time for every booking mode. One entry point per mode. */
class AvailabilityService {
  /** Slot services: every candidate slot on a date, flagged. */
  getAvailableSlots(params: { businessId: string; serviceId: string; date: string }) {
    return getSlotAvailability(params);
  }

  /** Nightly services (shortlets): each night in [from, to), flagged. */
  getNights(params: Parameters<typeof getNights>[0]) {
    return getNights(params);
  }

  /** Daily services (self-drive): pickup times on a date for `units` days, flagged. */
  getPickupTimes(params: Parameters<typeof getPickupTimes>[0]) {
    return getPickupTimes(params);
  }
}

export const availabilityService = new AvailabilityService();
