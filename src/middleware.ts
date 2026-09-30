import NextAuth from "next-auth";
import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server";

import { authConfig } from "@/server/auth/config";
import {
  botCardResponse,
  isSocialBot,
  renderBotCardHtml,
} from "@/utils/bot-card";
import { destinationCard } from "@/utils/cards";
import { appBaseUrl } from "@/utils/url";

const { auth } = NextAuth(authConfig);

/*
 * The first gate for the owner pages: no valid session JWT means straight to
 * sign-in with a real 307, before any page streams. Signature and expiry
 * only; whether the session is still live (not signed out) needs the
 * database, which the page checks itself (requireBusiness).
 */
const authed = auth((request) => {
  if (request.auth?.user?.sessionId) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  const signIn = new URL("/signin", request.url);
  signIn.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(signIn);
});

/*
 * `authed` as the (request, event) call Next makes of middleware. Auth.js
 * types auth(callback) only as a route handler, (request, context), which a
 * NextFetchEvent doesn't satisfy; the runtime call is the one its own docs
 * make for middleware. Types only.
 */
const runAuthed = authed as unknown as (
  request: NextRequest,
  event: NextFetchEvent,
) => ReturnType<typeof authed>;

/*
 * Link crawlers hold no session, so the gate would bounce them to /signin
 * and a shared /invoices link would preview as a sign-in form. A recognised
 * crawler gets the page's own card instead, before the gate runs: static
 * tags, no session read, no database (utils/bot-card.ts). It grants nothing;
 * the page itself still needs a session. Unrecognised crawlers follow the
 * redirect and get the same card from /signin?next=.
 */
export function middleware(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl;
  const card = destinationCard(pathname);
  if (card && isSocialBot(request.headers.get("user-agent"))) {
    const origin = appBaseUrl(request.nextUrl.origin);
    return botCardResponse(renderBotCardHtml(origin, pathname, card));
  }
  return runAuthed(request, event);
}

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
