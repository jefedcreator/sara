import z from 'zod';

export const oauthAuthorizationQueryValidatorSchema = z
    .object({
        callbackUrl: z.string().url().optional().default("http://localhost:3000/api/auth/facebook/callback"),
        redirect: z.enum(['true', 'false']).optional(),
    })
    .strict();

export const oauthCallbackQueryValidatorSchema = z
    .object({
        code: z.string().min(1, 'code is required').optional(),
        state: z.string().min(1, 'state is required').optional(),
    })
    .strict();

export const oauthCallbackValidatorSchema = oauthCallbackQueryValidatorSchema;

export type OAuthAuthorizationQueryValidatorSchema = z.infer<
    typeof oauthAuthorizationQueryValidatorSchema
>;

export type OAuthCallbackQueryValidatorSchema = z.infer<
    typeof oauthCallbackQueryValidatorSchema
>;

export type OAuthCallbackValidatorSchema = z.infer<
    typeof oauthCallbackValidatorSchema
>;
