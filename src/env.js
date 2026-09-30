import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    AUTH_SECRET:
      process.env.NODE_ENV === "production"
        ? z.string()
        : z.string().optional(),
    // Fallbacks for the public origin when NEXT_PUBLIC_APP_URL is unset (see utils/url.ts).
    AUTH_URL: z.string().url().optional(),
    NEXTAUTH_URL: z.string().url().optional(),
    AUTH_DISCORD_ID: z.string().optional(),
    AUTH_DISCORD_SECRET: z.string().optional(),
    AUTH_GOOGLE_ID: z.string().optional(),
    AUTH_GOOGLE_SECRET: z.string().optional(),
    AUTH_FACEBOOK_ID: z.string().optional(),
    AUTH_FACEBOOK_SECRET: z.string().optional(),
    AUTH_INSTAGRAM_ID: z.string().optional(),
    AUTH_INSTAGRAM_SECRET: z.string().optional(),
    CLIENT_ID: z.string().optional(),
    CLIENT_SECRET: z.string().optional(),
    CLOUDINARY_API_KEY: z.string(),
    CLOUDINARY_API_SECRET: z.string(),
    CLOUDINARY_CLOUD_NAME: z.string(),
    DATABASE_URL: z.string().url(),
    DIRECT_URL: z.string().url().optional(),
    FACEBOOK_CLIENT_ID: z.string().optional(),
    FACEBOOK_CLIENT_SECRET: z.string().optional(),
    INSTAGRAM_CLIENT_ID: z.string().optional(),
    INSTAGRAM_CLIENT_SECRET: z.string().optional(),
    CONFIGURATION_ID: z.string().optional(),
    MONO_SECRET_KEY: z.string().optional(),
    PAYSTACK_SECRET_KEY: z.string().optional(),
    PAYSTACK_WEBHOOK_SECRET: z.string().optional(),
    PAYSTACK_API_URL: z.string().url().optional(),
    MONO_CLIENT_ID: z.string().optional(),
    MONO_REDIRECT_URL: z.string().url().optional(),
    ATLAS_API_URL: z.string().url().optional(),
    RESEND_API_KEY: z.string().optional(),
    // "Sara <hello@your-domain>", on a domain verified in Resend.
    EMAIL_FROM: z.string().optional(),
    CRON_SECRET: z.string().optional(),
    WHATSAPP_VERIFY_TOKEN: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_TOKEN: z.string().optional(),
    META_APP_SECRET: z.string().optional(),
    INSTAGRAM_VERIFY_TOKEN: z.string().optional(),
    INSTAGRAM_IG_ID: z.string().optional(),
    INSTAGRAM_PAGE_TOKEN: z.string().optional(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    // NEXT_PUBLIC_CLIENTVAR: z.string(),
    NEXT_PUBLIC_MONO_PUBLIC_KEY: z.string().optional(),
    // The public origin (e.g. https://app.sara.ng): OAuth redirect URIs, booking links, emails.
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),
    // Sara's public WhatsApp number in international format without "+" (e.g. 2348012345678). Powers the landing "Start on WhatsApp" links.
    NEXT_PUBLIC_SARA_WHATSAPP_NUMBER: z
      .string()
      .regex(/^\d{8,15}$/)
      .optional(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_URL: process.env.AUTH_URL,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    AUTH_DISCORD_ID: process.env.AUTH_DISCORD_ID,
    AUTH_DISCORD_SECRET: process.env.AUTH_DISCORD_SECRET,
    AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
    AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET,
    AUTH_FACEBOOK_ID: process.env.AUTH_FACEBOOK_ID,
    AUTH_FACEBOOK_SECRET: process.env.AUTH_FACEBOOK_SECRET,
    AUTH_INSTAGRAM_ID: process.env.AUTH_INSTAGRAM_ID,
    AUTH_INSTAGRAM_SECRET: process.env.AUTH_INSTAGRAM_SECRET,
    CLIENT_ID: process.env.CLIENT_ID,
    CLIENT_SECRET: process.env.CLIENT_SECRET,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
    FACEBOOK_CLIENT_ID: process.env.FACEBOOK_CLIENT_ID,
    FACEBOOK_CLIENT_SECRET: process.env.FACEBOOK_CLIENT_SECRET,
    INSTAGRAM_CLIENT_ID: process.env.INSTAGRAM_CLIENT_ID,
    INSTAGRAM_CLIENT_SECRET: process.env.INSTAGRAM_CLIENT_SECRET,
    NODE_ENV: process.env.NODE_ENV,
    CONFIGURATION_ID: process.env.CONFIGURATION_ID,
    MONO_SECRET_KEY: process.env.MONO_SECRET_KEY,
    PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY,
    PAYSTACK_WEBHOOK_SECRET: process.env.PAYSTACK_WEBHOOK_SECRET,
    PAYSTACK_API_URL: process.env.PAYSTACK_API_URL,
    MONO_CLIENT_ID: process.env.MONO_CLIENT_ID,
    MONO_REDIRECT_URL: process.env.MONO_REDIRECT_URL,
    NEXT_PUBLIC_MONO_PUBLIC_KEY: process.env.NEXT_PUBLIC_MONO_PUBLIC_KEY,
    ATLAS_API_URL: process.env.ATLAS_API_URL,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    CRON_SECRET: process.env.CRON_SECRET,
    WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN,
    WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
    WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
    META_APP_SECRET: process.env.META_APP_SECRET,
    INSTAGRAM_VERIFY_TOKEN: process.env.INSTAGRAM_VERIFY_TOKEN,
    INSTAGRAM_IG_ID: process.env.INSTAGRAM_IG_ID,
    INSTAGRAM_PAGE_TOKEN: process.env.INSTAGRAM_PAGE_TOKEN,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SARA_WHATSAPP_NUMBER:
      process.env.NEXT_PUBLIC_SARA_WHATSAPP_NUMBER,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
