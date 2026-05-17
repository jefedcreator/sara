import { z } from "zod";
import { baseQueryValidatorSchema, decimalValidator } from "./index.validator";

const timeValidator = (field: string) =>
  z
    .string()
    .regex(
      /^([01]\d|2[0-3]):[0-5]\d$/,
      `${field} must be in HH:MM 24-hour format (e.g. "08:00")`,
    );

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
  price: decimalValidator("price"),
  duration: z.coerce
    .number()
    .int("duration must be an integer")
    .min(1, "duration must be at least 1 minute"),
  availableFrom: timeValidator("availableFrom").default("08:00"),
  availableTo: timeValidator("availableTo").default("17:00"),
  isActive: z.boolean().default(true),
});

const availabilityWindowRefine = <T extends { availableFrom?: string; availableTo?: string }>(
  schema: z.ZodType<T>,
) =>
  schema.refine(
    (data) => {
      if (data.availableFrom && data.availableTo) {
        return data.availableFrom < data.availableTo;
      }
      return true;
    },
    {
      message: "availableFrom must be earlier than availableTo",
      path: ["availableFrom"],
    },
  );

export const serviceValidatorSchema = availabilityWindowRefine(serviceBaseSchema);

export const updateServiceValidatorSchema = availabilityWindowRefine(
  serviceBaseSchema.partial().strict(),
);

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

export type ServiceValidatorSchema = z.infer<typeof serviceValidatorSchema>;
export type UpdateServiceValidatorSchema = z.infer<
  typeof updateServiceValidatorSchema
>;
export type ServiceQueryValidatorSchema = z.infer<
  typeof serviceQueryValidatorSchema
>;
