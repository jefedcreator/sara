import { z } from "zod";

export const atlasSearchQueryValidatorSchema = z
  .object({
    q: z.string().optional().default(""),
    lat: z.coerce.number().min(-90).max(90),
    lon: z.coerce.number().min(-180).max(180),
    category: z.string().optional(),
    radius_km: z.coerce.number().optional(),
    limit: z.coerce.number().optional().default(10),
    country: z.string().optional(),
  })
  .strict();
export type AtlasSearchQueryValidatorSchema = z.infer<typeof atlasSearchQueryValidatorSchema>;

export const atlasGeocodeQueryValidatorSchema = z
  .object({
    q: z.string().min(1, "Missing required query parameter: q"),
    limit: z.coerce.number().optional().default(5),
    country: z.string().optional(),
    lang: z.string().optional().default("en"),
  })
  .strict();
export type AtlasGeocodeQueryValidatorSchema = z.infer<typeof atlasGeocodeQueryValidatorSchema>;

export const atlasReverseQueryValidatorSchema = z
  .object({
    lat: z.coerce.number().min(-90).max(90),
    lon: z.coerce.number().min(-180).max(180),
    limit: z.coerce.number().optional().default(5),
    lang: z.string().optional().default("en"),
  })
  .strict();
export type AtlasReverseQueryValidatorSchema = z.infer<typeof atlasReverseQueryValidatorSchema>;

export const atlasRouteBodyValidatorSchema = z
  .object({
    origin: z
      .object({
        lat: z.coerce.number().min(-90).max(90),
        lon: z.coerce.number().min(-180).max(180),
      })
      .strict(),
    destination: z
      .object({
        lat: z.coerce.number().min(-90).max(90),
        lon: z.coerce.number().min(-180).max(180),
      })
      .strict(),
    profile: z.enum(["car", "motorcycle", "bicycle", "foot"]).optional().default("car"),
  })
  .strict();
export type AtlasRouteBodyValidatorSchema = z.infer<typeof atlasRouteBodyValidatorSchema>;
