import { z } from "zod";

// Kept apart from service.validator.ts (the API's schemas): this one parses
// the owner's form strings into the numbers the API takes.

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const WHOLE = /^\d+$/;

export const BOOKING_MODES = ["SLOT", "NIGHTLY", "DAILY"] as const;
export type BookingModeValue = (typeof BOOKING_MODES)[number];

export const serviceFormSchema = z
  .object({
    bookingMode: z.enum(BOOKING_MODES),
    name: z
      .string()
      .trim()
      .min(1, "Enter a name, like “Knotless braids”")
      .max(255, "Keep the name under 255 characters"),
    price: z
      .string()
      .trim()
      .min(1, "Enter a price")
      .transform((v) => v.replace(/[,\s]/g, ""))
      .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), { message: "Enter an amount in naira, like 25000" })
      .transform(Number),
    // Each of these is checked below only for the modes that use it.
    duration: z.string().trim(),
    availableFrom: z.string().regex(HHMM, "Pick a start time"),
    availableTo: z.string().regex(HHMM, "Pick an end time"),
    checkInTime: z.string().regex(HHMM, "Pick a check-in time"),
    checkOutTime: z.string().regex(HHMM, "Pick a check-out time"),
    minUnits: z.string().trim(),
    maxUnits: z.string().trim(),
    description: z.string().trim().max(1000, "Keep the description under 1,000 characters"),
  })
  .strict()
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });

    if (v.bookingMode === "SLOT") {
      if (!WHOLE.test(v.duration) || Number(v.duration) < 5) issue("duration", "Enter whole minutes, at least 5");
      else if (Number(v.duration) > 24 * 60) issue("duration", "Keep it under 24 hours");
    }
    if (v.bookingMode !== "NIGHTLY" && v.availableFrom >= v.availableTo) {
      issue("availableTo", v.bookingMode === "DAILY" ? "Pickups must start before they end" : "Bookings must start before they end");
    }
    if (v.bookingMode === "NIGHTLY" && v.checkOutTime > v.checkInTime) {
      issue("checkOutTime", "Check-out must be no later than check-in, so the next guest can arrive that day");
    }
    if (v.bookingMode !== "SLOT") {
      const noun = v.bookingMode === "NIGHTLY" ? "nights" : "days";
      const valid = (s: string) => WHOLE.test(s) && Number(s) >= 1 && Number(s) <= 90;
      if (!valid(v.minUnits)) issue("minUnits", `Enter 1 to 90 ${noun}`);
      if (!valid(v.maxUnits)) issue("maxUnits", `Enter 1 to 90 ${noun}`);
      else if (valid(v.minUnits) && Number(v.minUnits) > Number(v.maxUnits)) {
        issue("maxUnits", "Must be at least the minimum");
      }
    }
  })
  .transform((v) => ({
    bookingMode: v.bookingMode,
    name: v.name,
    price: v.price,
    description: v.description,
    duration: v.bookingMode === "SLOT" ? Number(v.duration) : 24 * 60,
    availableFrom: v.availableFrom,
    availableTo: v.availableTo,
    checkInTime: v.bookingMode === "NIGHTLY" ? v.checkInTime : undefined,
    checkOutTime: v.bookingMode === "NIGHTLY" ? v.checkOutTime : undefined,
    minUnits: v.bookingMode === "SLOT" ? 1 : Number(v.minUnits),
    maxUnits: v.bookingMode === "SLOT" ? 1 : Number(v.maxUnits),
  }));

export type ServiceFormInput = z.input<typeof serviceFormSchema>;
export type ServiceFormOutput = z.output<typeof serviceFormSchema>;
