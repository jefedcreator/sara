import z from "zod";

import { withoutDefaults } from "./index.validator";

const DELIVERY_FEE_MESSAGE = "Set a delivery fee, or 0 for free delivery";

/** Multipart sends "true"/"false"; JSON sends real booleans. */
const booleanField = z.preprocess(
  (value) => (value === "true" ? true : value === "false" ? false : value),
  z.boolean(),
);

/** Multipart sends a string and an empty field as ""; JSON sends a number or null. */
const deliveryFeeField = z.preprocess(
  (value) => {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    return typeof value === "string" ? Number(value) : value;
  },
  z
    .number({ message: "Enter a delivery fee, like 3000" })
    .min(0, "Delivery fee can't be negative")
    .nullable(),
);

const businessFields = {
  name: z.string().min(1, "Business name is required").max(100),
  slug: z.string().min(1, "Slug is required").max(100).optional(),
  description: z.string().max(500).optional(),
  phone: z.string().optional(),
  email: z.string().email("Invalid email address").optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  logoUrl: z.string().url("Invalid logo URL").optional(),
  currency: z.string().length(3).default("USD").optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  sells: z.enum(["SERVICES", "PRODUCTS", "BOTH"]).optional(),
  offersDelivery: booleanField.optional(),
  deliveryFee: deliveryFeeField.optional(),
  offersPickup: booleanField.optional(),
  monoCode: z.string().min(1, "Mono authorization code is required"),
};

const businessObjectSchema = z.object(businessFields);

/** Delivery is a fee, and free delivery is an explicit 0. */
function requireDeliveryFee(
  data: { offersDelivery?: boolean; deliveryFee?: number | null },
  ctx: z.RefinementCtx,
) {
  if (
    data.offersDelivery &&
    (data.deliveryFee === undefined || data.deliveryFee === null)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["deliveryFee"],
      message: DELIVERY_FEE_MESSAGE,
    });
  }
}

export const businessValidatorSchema =
  businessObjectSchema.superRefine(requireDeliveryFee);

export const updateBusinessValidatorSchema = z
  .object(withoutDefaults(businessObjectSchema.shape))
  .partial()
  .strict()
  .superRefine(requireDeliveryFee);

export type BusinessValidatorSchema = z.infer<typeof businessValidatorSchema>;
export type UpdateBusinessValidatorSchema = z.infer<
  typeof updateBusinessValidatorSchema
>;

const optionalText = (max: number, message: string) =>
  z.string().trim().max(max, message);

/**
 * The owner's first-run business form (the Mono code is added once the bank
 * is linked). Empty optional inputs arrive as "" and are dropped on send.
 */
export const businessSetupFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Enter your business name")
      .max(100, "Keep the name under 100 characters"),
    phone: optionalText(20, "Keep the number under 20 characters").refine(
      (v) => v === "" || /^\+?[\d\s-]{7,19}$/.test(v),
      { message: "Enter a valid phone number, like 0803 123 4567" },
    ),
    email: z
      .string()
      .trim()
      .refine((v) => v === "" || z.string().email().safeParse(v).success, {
        message: "Enter a valid email, like hello@tobibeauty.ng",
      }),
    address: optionalText(200, "Keep the address under 200 characters"),
    city: optionalText(80, "Keep the city under 80 characters"),
    state: optionalText(80, "Keep the state under 80 characters"),
  })
  .strict();

export type BusinessSetupFormSchema = z.infer<typeof businessSetupFormSchema>;

/** Settings: the setup fields plus a description. */
export const businessProfileFormSchema = businessSetupFormSchema.extend({
  description: optionalText(500, "Keep the description under 500 characters"),
});

export type BusinessProfileFormSchema = z.infer<typeof businessProfileFormSchema>;

/** A one-off day off, as the settings form sends it. */
export const closureFormSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
    reason: optionalText(255, "Keep the reason under 255 characters"),
  })
  .strict();

export type ClosureFormSchema = z.infer<typeof closureFormSchema>;
