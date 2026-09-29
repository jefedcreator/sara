import { z } from "zod";

// Kept apart from service.validator.ts (the API's schemas): this one parses
// the owner's form strings into the numbers the API takes.

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const serviceFormSchema = z
  .object({
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
      .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), {
        message: "Enter an amount in naira, like 25000",
      })
      .transform(Number),
    duration: z
      .string()
      .trim()
      .min(1, "Enter how long it takes")
      .refine((v) => /^\d+$/.test(v) && Number(v) >= 5, {
        message: "Enter whole minutes, at least 5",
      })
      .transform(Number)
      .refine((v) => v <= 24 * 60, { message: "Keep it under 24 hours" }),
    availableFrom: z.string().regex(HHMM, "Pick a start time"),
    availableTo: z.string().regex(HHMM, "Pick an end time"),
    description: z
      .string()
      .trim()
      .max(1000, "Keep the description under 1,000 characters"),
  })
  .strict()
  .refine((v) => v.availableFrom < v.availableTo, {
    message: "Bookings must start before they end",
    path: ["availableTo"],
  });

export type ServiceFormInput = z.input<typeof serviceFormSchema>;
export type ServiceFormOutput = z.output<typeof serviceFormSchema>;
