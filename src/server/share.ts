import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/env";
import { appBaseUrl } from "@/utils/url";

/*
 * The customer's link to an invoice or receipt: /i/<slug>/<key> and
 * /r/<slug>/<key>. Slugs are "<business>-<number>" and so guessable; the key,
 * an HMAC of the slug, is what makes the link the customer's alone. It sits
 * in the path rather than the query so the route's opengraph-image, which
 * only sees path params, can check it too.
 *
 * Signed with AUTH_SECRET (required in production by src/env.js). Rotating
 * that secret retires every share link already sent.
 */

export type SharedKind = "invoice" | "receipt";

const ROUTE: Record<SharedKind, string> = { invoice: "i", receipt: "r" };

// 16 base64url characters: 96 bits, short enough for a chat bubble.
const KEY_LENGTH = 16;

function sign(kind: SharedKind, slug: string) {
  return createHmac("sha256", env.AUTH_SECRET ?? "sara-dev-share-secret")
    .update(`${kind}:${slug}`)
    .digest("base64url")
    .slice(0, KEY_LENGTH);
}

export function sharePath(kind: SharedKind, slug: string) {
  return `/${ROUTE[kind]}/${encodeURIComponent(slug)}/${sign(kind, slug)}`;
}

/** The absolute link Sara sends the customer. */
export function shareUrl(kind: SharedKind, slug: string) {
  return `${appBaseUrl()}${sharePath(kind, slug)}`;
}

export function isShareKey(kind: SharedKind, slug: string, key: string) {
  const expected = Buffer.from(sign(kind, slug));
  const given = Buffer.from(key);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
