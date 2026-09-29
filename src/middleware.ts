import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import { authConfig } from "@/server/auth/config";

const { auth } = NextAuth(authConfig);

/*
 * The first gate for the owner pages: no valid session JWT means straight to
 * sign-in with a real 307, before any page streams. Signature and expiry
 * only; whether the session is still live (not signed out) needs the
 * database, which the page checks itself (requireBusiness).
 */
export const middleware = auth((request) => {
  if (request.auth?.user?.sessionId) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(signIn);
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/bookings/:path*",
    "/invoices/:path*",
    "/receipts/:path*",
    "/services/:path*",
    "/settings/:path*",
    "/onboarding",
  ],
};
