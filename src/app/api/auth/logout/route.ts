import { withMiddleware } from "@/backend/middleware";
import { authService } from "@/backend/services/auth";
import { SESSION_COOKIE, sessionCookieOptions } from "@/server/auth/shared";
import { publicOrigin } from "@/utils/url";
import { NextResponse } from "next/server";

/**
 * @description Revokes the current session, clears its cookie and redirects to the home page. Succeeds whether or not a session was present.
 */
export const POST = withMiddleware<unknown>(async (request) => {
  await authService.signOut(request);

  const response = NextResponse.redirect(new URL("/", publicOrigin(request)), {
    status: 303,
  });
  // Expired with the attributes it was set with, so the browser matches it.
  response.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
  return response;
}, []);
