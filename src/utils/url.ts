import { env } from "@/env";
import type { NextRequest } from "next/server";

/**
 * Resolves the public origin for an incoming request, respecting reverse proxy
 * headers (X-Forwarded-Host, X-Forwarded-Proto) and NEXT_PUBLIC_APP_URL.
 */
export function publicOrigin(request: NextRequest): string {
  const proto =
    request.headers.get("x-forwarded-proto") ??
    request.nextUrl.protocol.replace(/:$/, "");
  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host");

  const requestOrigin =
    host && !host.includes("localhost") && !host.includes("127.0.0.1")
      ? `${proto}://${host}`
      : request.nextUrl.origin;

  let origin = appBaseUrl(requestOrigin);
  if (
    proto === "https" &&
    origin.startsWith("http://") &&
    !origin.includes("localhost") &&
    !origin.includes("127.0.0.1")
  ) {
    origin = origin.replace(/^http:\/\//, "https://");
  }
  return origin;
}

/**
 * The app's public origin, without a trailing slash: NEXT_PUBLIC_APP_URL,
 * else Auth.js's AUTH_URL / NEXTAUTH_URL, else the origin of the request
 * being served, else localhost. Every absolute link the app builds (OAuth
 * redirect URIs, booking links, redirects after a callback) starts here.
 */
export function appBaseUrl(requestOrigin?: string): string {
  let base =
    env.NEXT_PUBLIC_APP_URL ??
    env.AUTH_URL ??
    env.NEXTAUTH_URL ??
    requestOrigin ??
    "http://localhost:3000";
  base = base.replace(/\/$/, "");
  if (
    env.NODE_ENV === "production" &&
    base.startsWith("http://") &&
    !base.includes("localhost") &&
    !base.includes("127.0.0.1")
  ) {
    base = base.replace(/^http:\/\//, "https://");
  }
  return base;
}

export function publicUrl(path: string, slug: string): string {
  return `${appBaseUrl()}/${path}/${slug}`;
}
