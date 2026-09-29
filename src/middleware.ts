import { NextResponse, type NextRequest } from "next/server";

/*
 * A cheap first gate for the owner pages: no session cookie at all means
 * straight to sign-in with a real 307, before any page streams. Whether the
 * cookie is still valid is checked by the page itself (requireBusiness).
 */
export function middleware(request: NextRequest) {
  if (request.cookies.get("sara-session")?.value) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: ["/services/:path*", "/settings/:path*", "/onboarding"],
};
