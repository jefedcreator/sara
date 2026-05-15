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
});

export const updateBusinessValidatorSchema = businessValidatorSchema
  .partial()
  .strict();

export type BusinessValidatorSchema = z.infer<typeof businessValidatorSchema>;
export type UpdateBusinessValidatorSchema = z.infer<
  typeof updateBusinessValidatorSchema
>;
