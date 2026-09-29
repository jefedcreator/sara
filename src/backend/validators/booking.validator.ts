import { z } from "zod";
import { baseQueryValidatorSchema, dateValidator } from "./index.validator";

const cuidValidator = z.string().cuid("id must be a valid cuid");

export const bookingValidatorSchema = z.object({
  serviceId: cuidValidator,
  startTime: dateValidator("startTime"),
  endTime: dateValidator("endTime"),

  // Client Details
  clientName: z
    .string()
    .min(1, "clientName cannot be empty")
    .max(255, "clientName cannot exceed 255 characters"),
  clientEmail: z.string().email("clientEmail must be a valid email").optional(),
  clientPhone: z
    .string()
    .max(20, "clientPhone cannot exceed 20 characters")
    .optional(),

  notes: z
    .string()
    .max(1000, "notes cannot exceed 1000 characters")
    .optional(),

  // Client geolocation (optional — used for Atlas routing)
  clientLat: z.coerce
    .number()
    .min(-90, "clientLat must be ≥ -90")
    .max(90, "clientLat must be ≤ 90")
    .optional(),
  clientLong: z.coerce
    .number()
    .min(-180, "clientLong must be ≥ -180")
    .max(180, "clientLong must be ≤ 180")
    .optional(),
});

export const bookingQueryValidatorSchema = baseQueryValidatorSchema
  .partial()
  .extend({
    status: z
      .enum(["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED"], {
        message:
          "status must be one of: PENDING, CONFIRMED, COMPLETED, CANCELLED",
      })
      .optional(),
    serviceId: z.string().optional(),
    sortBy: z
      .enum(
        ["startTime", "createdAt", "updatedAt", "status"],
        "sortBy must be one of: startTime, createdAt, updatedAt, status",
      )
      .default("createdAt")
      .optional(),
  })
  .strict();

export const updateBookingValidatorSchema = z
  .object({
    status: z
      .enum(["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED"], {
        message:
          "status must be one of: PENDING, CONFIRMED, COMPLETED, CANCELLED",
      })
      .optional(),
    startTime: dateValidator("startTime").optional(),
    endTime: dateValidator("endTime").optional(),
    clientName: z
      .string()
      .min(1, "clientName cannot be empty")
      .max(255, "clientName cannot exceed 255 characters")
      .optional(),
    clientEmail: z
      .string()
      .email("clientEmail must be a valid email")
      .optional(),
    clientPhone: z
      .string()
      .max(20, "clientPhone cannot exceed 20 characters")
      .optional(),
    notes: z
      .string()
      .max(1000, "notes cannot exceed 1000 characters")
      .optional(),
  })
  .strict();

export type BookingValidatorSchema = z.infer<typeof bookingValidatorSchema>;
export type UpdateBookingValidatorSchema = z.infer<
  typeof updateBookingValidatorSchema
>;
export type BookingQueryValidatorSchema = z.infer<
  typeof bookingQueryValidatorSchema
>;

/**
 * The customer's details on the public booking page. Email is required here
 * (though optional in the API) because confirmations, reminders and the
 * Paystack receipt all go to it; phone and notes are optional. Empty inputs
 * arrive as "" from the form and are dropped before sending.
 */
export const bookingDetailsFormSchema = z
  .object({
    clientName: z
      .string()
      .trim()
      .min(1, "Enter your name")
      .max(255, "Keep your name under 255 characters"),
    clientEmail: z
      .string()
      .trim()
      .min(1, "Enter your email so we can send your confirmation")
      .email("Enter a valid email, like ada@example.com"),
    clientPhone: z
      .string()
      .trim()
      .max(20, "Keep the number under 20 characters")
      .refine((v) => v === "" || /^\+?[\d\s-]{7,19}$/.test(v), {
        message: "Enter a valid phone number, like 0803 123 4567",
      }),
    notes: z
      .string()
      .trim()
      .max(1000, "Keep notes under 1,000 characters"),
  })
  .strict();

export type BookingDetailsFormSchema = z.infer<typeof bookingDetailsFormSchema>;
