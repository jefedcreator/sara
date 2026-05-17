import { z } from "zod";
import {
  baseQueryValidatorSchema,
  decimalValidator,
} from "./index.validator";

const cuidValidator = z.string().cuid("id must be a valid cuid");

export const serviceValidatorSchema = z.object({
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
      message: 'image must be a valid file',
    })
    .nullable()
    .optional(),
  price: decimalValidator("price"),
  duration: z.coerce
    .number()
    .int("duration must be an integer")
    .min(1, "duration must be at least 1 minute"),
  isActive: z.boolean().default(true),
});

export const updateServiceValidatorSchema = serviceValidatorSchema
  .partial()
  .strict();

export const serviceQueryValidatorSchema = baseQueryValidatorSchema
  .partial()
  .extend({
    isActive: z
      .string()
      .transform((val) => val === "true")
      .or(z.boolean())
      .optional(),
    name: z
      .string()
      .max(255, "name cannot exceed 255 characters")
      .optional(),
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
