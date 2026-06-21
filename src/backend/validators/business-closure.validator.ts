import { z } from "zod";

export const businessClosureValidatorSchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be in YYYY-MM-DD format"),
    reason: z
      .string()
      .max(255, "reason cannot exceed 255 characters")
      .optional(),
  })
  .strict();

export type BusinessClosureValidatorSchema = z.infer<
  typeof businessClosureValidatorSchema
>;
