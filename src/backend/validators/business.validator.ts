import z from "zod";

export const businessValidatorSchema = z.object({
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
  monoCode: z.string().min(1, "Mono authorization code is required"),
});

export const updateBusinessValidatorSchema = businessValidatorSchema
  .partial()
  .strict();

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
