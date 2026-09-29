import z from "zod";

export const oauthAuthorizationQueryValidatorSchema = z.object({
  next: z.string().optional(),
});

export const oauthCallbackQueryValidatorSchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

export type OAuthAuthorizationQueryValidatorSchema = z.infer<
  typeof oauthAuthorizationQueryValidatorSchema
>;

export type OAuthCallbackQueryValidatorSchema = z.infer<
  typeof oauthCallbackQueryValidatorSchema
>;
