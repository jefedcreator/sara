/*
 * Session constants shared by Edge middleware, the Auth.js config and the
 * auth service. Deliberately imports nothing: middleware loads this on the
 * Edge runtime, where `@/env` would run zod validation on every request and
 * the database cannot be reached at all.
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

/**
 * The key session JWTs are encrypted with, read the same way by the minting
 * side and the verifying side so the two cannot drift apart. `||`, not `??`:
 * an empty AUTH_SECRET is a missing one.
 */
export function readAuthSecret() {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  return process.env.AUTH_SECRET || undefined;
}

/** Attributes every auth cookie is set with, minus its lifetime. */
export const sessionCookieAttributes = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
};

export function sessionCookieOptions(maxAge = SESSION_MAX_AGE_SECONDS) {
  return { ...sessionCookieAttributes, maxAge };
}
