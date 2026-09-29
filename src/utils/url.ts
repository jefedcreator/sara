import { env } from "@/env";

/**
 * The app's public origin, without a trailing slash: NEXT_PUBLIC_APP_URL,
 * else Auth.js's AUTH_URL / NEXTAUTH_URL, else the origin of the request
 * being served, else localhost. Every absolute link the app builds (OAuth
 * redirect URIs, booking links, redirects after a callback) starts here.
 */
export function appBaseUrl(requestOrigin?: string): string {
  const base =
    env.NEXT_PUBLIC_APP_URL ??
    env.AUTH_URL ??
    env.NEXTAUTH_URL ??
    requestOrigin ??
    "http://localhost:3000";
  return base.replace(/\/$/, "");
}

export function publicUrl(path: string, slug: string): string {
  return `${appBaseUrl()}/${path}/${slug}`;
}
