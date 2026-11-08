import { NextResponse, type NextRequest } from "next/server";

/**
 * Error formatter for the OAuth routes. A browser arriving from a provider
 * must never be handed a JSON error body, so every failure becomes a redirect
 * back to /signin with an error code.
 */
export function oauthErrorResponse(
  error: unknown,
  request: NextRequest,
): { status: number; message: string; response: Response } {
  console.error("[auth] OAuth route failed:", error);
  const url = new URL("/signin", request.url);
  url.searchParams.set("error", "failed");
  return {
    status: 303,
    message: "Sign-in failed",
    response: NextResponse.redirect(url),
  };
}
