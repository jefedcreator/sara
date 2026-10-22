import { z } from "zod";

import { baseQueryValidatorSchema } from "./index.validator";

const cuidValidator = z.string().cuid("id must be a valid cuid");

export const customerQueryValidatorSchema = baseQueryValidatorSchema
  .partial()
  .extend({
    query: z
      .string()
      .trim()
      .max(255, "query cannot exceed 255 characters")
      .optional(),
    page: baseQueryValidatorSchema.shape.page,
    size: baseQueryValidatorSchema.shape.size,
  })
  .strict();

export const updateCustomerValidatorSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "name cannot be empty")
      .max(255, "name cannot exceed 255 characters")
      .optional(),
    phone: z
      .string()
      .trim()
      .max(50, "phone cannot exceed 50 characters")
      .nullable()
      .optional(),
    email: z
      .string()
      .trim()
      .email("email must be a valid email")
      .max(255, "email cannot exceed 255 characters")
      .nullable()
      .optional(),
    address: z
      .string()
      .trim()
      .max(1000, "address cannot exceed 1000 characters")
      .nullable()
      .optional(),
    notes: z
      .string()
      .trim()
      .max(2000, "notes cannot exceed 2000 characters")
      .nullable()
      .optional(),
  })
  .strict();

export const mergeCustomerValidatorSchema = z
  .object({
    keepId: cuidValidator,
    mergeId: cuidValidator,
  })
  .strict();

export type CustomerQueryValidatorSchema = z.infer<
  typeof customerQueryValidatorSchema
>;
export type UpdateCustomerValidatorSchema = z.infer<
  typeof updateCustomerValidatorSchema
>;
export type MergeCustomerValidatorSchema = z.infer<
  typeof mergeCustomerValidatorSchema
>;
