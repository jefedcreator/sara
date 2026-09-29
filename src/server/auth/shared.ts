import { env } from "@/env";

/*
 * Session constants shared by Edge middleware, the Auth.js config and the
 * auth service. Middleware loads this on the Edge runtime, so it imports
 * nothing but `@/env` (validated once when the module loads) and never the
 * database.
 */

/**
 * The Auth.js session JWT cookie. Named explicitly rather than left to
 * Auth.js, which flips its default to `__Secure-authjs.session-token` on
 * HTTPS: the service that mints the token and every reader that verifies it
 * must agree on the name, because the name is also the encryption salt.
 */
export const SESSION_COOKIE = "sara-auth";

/** 30 days, for both the JWT and the `Session` row it points at. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Attributes every auth cookie is set with, minus its lifetime. */
export const sessionCookieAttributes = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: env.NODE_ENV === "production",
};

export function sessionCookieOptions(maxAge = SESSION_MAX_AGE_SECONDS) {
  return { ...sessionCookieAttributes, maxAge };
}
