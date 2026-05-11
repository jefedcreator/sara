import { handlers } from "@/server/auth";

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
