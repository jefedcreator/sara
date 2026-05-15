import { z } from "zod";

export const baseQueryValidatorSchema = z
  .object({
    page: z
      .string()
      .transform((val) => parseInt(val, 10))
      .pipe(
        z
          .number({
            message: "page must be a valid number",
          })
          .int("page must be an integer")
          .min(1, "page must be at least 1"),
      )
      .default(1),
    size: z
      .string()
      .transform((val) => parseInt(val, 10))
      .pipe(
        z
          .number({
            message: "limit must be a valid number",
          })
          .int("limit must be an integer")
          .min(1, "limit must be at least 1")
          .max(100, "limit cannot exceed 100"),
      )
      .default(10),
    query: z
      .string({
        message: "search must be a valid string",
      })
      .max(255, "search cannot exceed 255 characters")
      .optional(),
    sortBy: z
      .enum(["name", "createdAt", "updatedAt"], {
        message: "sortBy must be one of: name, createdAt, updatedAt",
      })
      .default("createdAt")
      .optional(),
    sortOrder: z
      .enum(["asc", "desc"], {
        message: "sortOrder must be either 'asc' or 'desc'",
      })
      .default("desc")
      .optional(),
    all: z
      .string()
      .transform((val) => val === "true")
      .pipe(
        z.boolean({
          message: "all must be a boolean value",
        }),
      )
      .optional(),
    isOg: z
      .string()
      .transform((val) => val === "true")
      .pipe(
        z.boolean({
          message: "isOg must be a boolean value",
        }),
      )
      .optional(),
    isMomentOg: z
      .string()
      .transform((val) => val === "true")
      .pipe(
        z.boolean({
          message: "isMomentOg must be a boolean value",
        }),
      )
      .optional(),
  })
  .strict();

export type BaseQueryValidatorSchema = z.infer<typeof baseQueryValidatorSchema>;

export type BaseQueryValidatorInput = z.input<typeof baseQueryValidatorSchema>;

// export const paramValidator = z.object({ id: mongoIdValidator });

export const decimalValidator = (field: string) =>
  z.coerce
    .number()
    .finite(`${field} must be a finite number`)
    .min(0, `${field} cannot be negative`);

export const dateValidator = (field: string) =>
  z.coerce.date(`${field} must be a valid date`);

export const slugParamValidator = z.object({
  slug: z.string().min(1, "slug is required"),
});

export const nextAuthPathParamValidator = z.object({
  nextauth: z.array(z.string().min(1)).min(1, "nextauth path is required"),
});
