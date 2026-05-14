import z from 'zod';

export const businessValidatorSchema = z.object({
  name: z.string().min(1, 'Business name is required').max(100),
  slug: z.string().min(1, 'Slug is required').max(100).optional(),
  description: z.string().max(500).optional(),
  phone: z.string().optional(),
  email: z.string().email('Invalid email address').optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  logoUrl: z.string().url('Invalid logo URL').optional(),
  currency: z.string().length(3).default('USD').optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

export type BusinessValidatorSchema = z.infer<typeof businessValidatorSchema>;
