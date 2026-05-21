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
