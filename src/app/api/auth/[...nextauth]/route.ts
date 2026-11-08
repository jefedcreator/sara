import { handlers } from "@/server/auth";

/*
 * Auth.js's own catch-all handler. It is the one route exempt from
 * `withMiddleware`: it owns its request/response contract (session JSON,
 * CSRF, provider callbacks) and returns its own errors, so wrapping it would
 * change behaviour Auth.js depends on.
 */

/**
 * @pathParams nextAuthPathParamValidator
 * @description Handles NextAuth GET requests for session and provider auth routes.
 */
export const GET = handlers.GET;

/**
 * @pathParams nextAuthPathParamValidator
 * @description Handles NextAuth POST requests for callbacks, sign-in, and sign-out routes.
 */
export const POST = handlers.POST;
