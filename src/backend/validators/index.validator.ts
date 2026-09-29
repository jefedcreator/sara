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

export const timeValidator = (field: string) =>
  z
    .string()
    .regex(
      /^([01]\d|2[0-3]):[0-5]\d$/,
      `${field} must be in HH:MM 24-hour format (e.g. "08:00")`,
    );

export const slugParamValidator = z.object({
  slug: z.string().min(1, "slug is required"),
});

export const nextAuthPathParamValidator = z.object({
  nextauth: z.array(z.string().min(1)).min(1, "nextauth path is required"),
});

type StripDefault<S> =
  S extends z.ZodOptional<infer Inner>
    ? StripDefault<Inner>
    : S extends z.ZodDefault<infer Inner>
      ? StripDefault<Inner>
      : S;

/**
 * A create schema's fields with their `.default()`s removed, for building the
 * matching update schema: `z.object(withoutDefaults(create.shape)).partial()`.
 *
 * `.partial()` alone keeps defaults in Zod 4, so an update that leaves a field
 * out gets it filled with the create-time default (an invoice edit resetting
 * its status to DRAFT, a paused service getting 08:00–17:00 hours back).
 * Optional wrappers are removed too; `.partial()` adds them back.
 */
export function withoutDefaults<T extends z.ZodRawShape>(shape: T) {
  const strip = (schema: z.ZodType): z.ZodType => {
    if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
      return strip(schema.unwrap() as z.ZodType);
    }
    return schema;
  };
  return Object.fromEntries(
    Object.entries(shape).map(([key, schema]) => [key, strip(schema as z.ZodType)]),
  ) as unknown as { [K in keyof T]: StripDefault<T[K]> };
}
