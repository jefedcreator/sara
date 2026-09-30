import { z } from "zod";
import { baseQueryValidatorSchema, withoutDefaults } from "./index.validator";

const cuidValidator = z.string().cuid("id must be a valid cuid");

const serviceBaseSchema = z.object({
  name: z
    .string()
    .min(1, "name cannot be empty")
    .max(255, "name cannot exceed 255 characters"),
  description: z
    .string()
    .max(1000, "description cannot exceed 1000 characters")
    .nullable()
    .optional(),
  image: z
    .custom<File>((file) => file instanceof File, {
      message: "image must be a valid file",
    })
    .nullable()
    .optional(),
  price: z.coerce
    .number()
    .finite("price must be a finite number")
    .min(0, "price cannot be negative"),
  duration: z.coerce
    .number()
    .int("duration must be an integer")
    .min(1, "duration must be at least 1 minute"),
  availableFrom: z
    .string()
    .regex(
      /^([01]\d|2[0-3]):[0-5]\d$/,
      'availableFrom must be in HH:MM 24-hour format (e.g. "08:00")',
    )
    .default("08:00"),
  availableTo: z
    .string()
    .regex(
      /^([01]\d|2[0-3]):[0-5]\d$/,
      'availableTo must be in HH:MM 24-hour format (e.g. "08:00")',
    )
    .default("17:00"),
  isActive: z.boolean().default(true),
});

const checkAvailabilityWindow = (data: {
  availableFrom?: string;
  availableTo?: string;
}) => {
  if (data.availableFrom && data.availableTo) {
    return data.availableFrom < data.availableTo;
  }
  return true;
};

const availabilityWindowRefineOptions = {
  message: "availableFrom must be earlier than availableTo",
  path: ["availableFrom"],
};

export const serviceValidatorSchema = serviceBaseSchema.refine(
  checkAvailabilityWindow,
  availabilityWindowRefineOptions,
);

export const updateServiceValidatorSchema = z
  .object(withoutDefaults(serviceBaseSchema.shape))
  .partial()
  .strict()
  .refine(checkAvailabilityWindow, availabilityWindowRefineOptions);

export const serviceQueryValidatorSchema = baseQueryValidatorSchema
  .partial()
  .extend({
    isActive: z
      .string()
      .transform((val) => val === "true")
      .or(z.boolean())
      .optional(),
    name: z.string().max(255, "name cannot exceed 255 characters").optional(),
    sortBy: z
      .enum(
        ["name", "price", "duration", "createdAt", "updatedAt"],
        "sortBy must be one of: name, price, duration, createdAt, updatedAt",
      )
      .default("createdAt")
      .optional(),
  })
  .strict();

export const serviceDetailQueryValidatorSchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be in YYYY-MM-DD format")
      .optional(),
  })
  .strict();

export type ServiceValidatorSchema = z.infer<typeof serviceValidatorSchema>;
export type UpdateServiceValidatorSchema = z.infer<
  typeof updateServiceValidatorSchema
>;
export type ServiceQueryValidatorSchema = z.infer<
  typeof serviceQueryValidatorSchema
>;
export type ServiceDetailQueryValidatorSchema = z.infer<
  typeof serviceDetailQueryValidatorSchema
>;
