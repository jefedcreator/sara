import { z } from "zod";

import { withoutDefaults } from "./index.validator";

const MAX_PHOTOS = 5;
const MAX_OPTIONS = 20;
const MAX_NAME_LENGTH = 255;

/** Multipart fields arrive as strings; the product editor also sends booleans. */
const booleanFromFormSchema = z
  .union([z.boolean(), z.enum(["true", "false"])], {
    error: "must be true or false",
  })
  .transform((value) => value === true || value === "true");

export const productOptionValidatorSchema = z
  .object({
    id: z.string().min(1, "id cannot be empty").optional(),
    name: z
      .string()
      .trim()
      .max(MAX_NAME_LENGTH, `name cannot exceed ${MAX_NAME_LENGTH} characters`),
    price: z.coerce
      .number()
      .finite("price must be a finite number")
      .min(0, "price cannot be negative")
      .nullable()
      .optional(),
    stock: z.coerce
      .number()
      .int("stock must be a whole number")
      .min(0, "stock cannot be negative"),
  })
  .strict();

/**
 * The options field is a JSON string in multipart forms, but accepting an
 * already-parsed array keeps the schema easy to call from tests and clients
 * that post JSON-shaped values.
 */
const optionsFromFormSchema = z
  .union([z.string(), z.array(productOptionValidatorSchema)])
  .transform((value, ctx) => {
    if (Array.isArray(value)) return value;

    try {
      const parsed: unknown = JSON.parse(value);
      if (!Array.isArray(parsed)) {
        ctx.addIssue({
          code: "custom",
          message: "options must be a JSON array",
        });
        return z.NEVER;
      }
      return parsed as unknown[];
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "options must be valid JSON",
      });
      return z.NEVER;
    }
  })
  .pipe(
    z
      .array(productOptionValidatorSchema)
      .min(1, "A product needs at least one option")
      .max(MAX_OPTIONS, `A product can have up to ${MAX_OPTIONS} options`),
  );

const productBaseSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "name cannot be empty")
    .max(MAX_NAME_LENGTH, `name cannot exceed ${MAX_NAME_LENGTH} characters`),
  description: z
    .string()
    .trim()
    .max(1000, "description cannot exceed 1000 characters")
    .nullable()
    .optional(),
  price: z.coerce
    .number()
    .finite("price must be a finite number")
    .min(0, "price cannot be negative"),
  tracksStock: booleanFromFormSchema.default(true),
  options: optionsFromFormSchema,
});

/** Parses the multipart fields of POST /api/products. Photos are handled by the route. */
export const productValidatorSchema = productBaseSchema.strict();

const photoListFromFormSchema = z
  .union([z.string(), z.array(z.string().min(1, "photo URLs cannot be empty"))])
  .transform((value, ctx) => {
    if (Array.isArray(value)) return value;

    try {
      const parsed: unknown = JSON.parse(value);
      if (!Array.isArray(parsed)) {
        ctx.addIssue({
          code: "custom",
          message: "keepPhotos must be a JSON array of URLs",
        });
        return z.NEVER;
      }
      return parsed as unknown[];
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "keepPhotos must be valid JSON",
      });
      return z.NEVER;
    }
  })
  .pipe(
    z
      .array(z.string().min(1, "photo URLs cannot be empty"))
      .max(MAX_PHOTOS, `A product can have up to ${MAX_PHOTOS} photos`),
  );

/** Parses the multipart fields of PUT /api/products/[slug]. */
export const updateProductValidatorSchema = z
  .object(withoutDefaults(productBaseSchema.shape))
  .partial()
  .extend({
    keepPhotos: photoListFromFormSchema.optional(),
    isActive: booleanFromFormSchema.optional(),
  })
  .strict();

export const productQueryValidatorSchema = z
  .object({
    includeInactive: booleanFromFormSchema.optional(),
  })
  .strict();

export const stockAdjustValidatorSchema = z
  .object({
    optionId: z.string().min(1, "optionId is required"),
    add: z.coerce
      .number()
      .int("add must be a whole number")
      .optional(),
    set: z.coerce
      .number()
      .int("set must be a whole number")
      .min(0, "set cannot be negative")
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasAdd = value.add !== undefined;
    const hasSet = value.set !== undefined;

    if (hasAdd && hasSet) {
      ctx.addIssue({
        code: "custom",
        path: ["add"],
        message: "Choose either add or set, not both",
      });
      return;
    }

    if (!hasAdd && !hasSet) {
      ctx.addIssue({
        code: "custom",
        path: ["add"],
        message: "Choose either add or set",
      });
      return;
    }

    if (value.add === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["add"],
        message: "add cannot be 0",
      });
    }
  });

export type ProductOptionValidatorSchema = z.infer<
  typeof productOptionValidatorSchema
>;
export type ProductValidatorSchema = z.infer<typeof productValidatorSchema>;
export type UpdateProductValidatorSchema = z.infer<
  typeof updateProductValidatorSchema
>;
export type ProductQueryValidatorSchema = z.infer<
  typeof productQueryValidatorSchema
>;
export type StockAdjustValidatorSchema = z.infer<
  typeof stockAdjustValidatorSchema
>;
