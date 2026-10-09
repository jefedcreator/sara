import { NextResponse } from "next/server";

import { CARDS, OG_SIZE, SITE_NAME, type CardKey } from "@/utils/cards";

/*
 * The preview page served to link unfurlers in place of an owner-only page.
 *
 * A crawler holds no session, so the middleware would 307 it to /signin and
 * the chat would preview a sign-in form (or, for unfurlers that don't follow
 * redirects, nothing). The middleware answers the ones it recognises with
 * this instead: the page's own card, no redirect, no database. It runs on the
 * Edge, so it builds its tags by hand rather than through pageMetadata.
 */

/**
 * Lower-case user-agent fragments of link unfurlers and the search crawlers
 * that read the same tags. Anything missing still follows the redirect and
 * gets the same card from /signin?next=, one hop later.
 *
 * Only crawler names: an in-app browser's user agent carries its app's name
 * ("Instagram 312.0", "[Pinterest/Android]"), and matching that would hand a
 * real, signed-out owner this bare card instead of the sign-in page.
 * Instagram and Facebook both unfurl as facebookexternalhit.
 */
const BOT_USER_AGENTS = [
  "whatsapp",
  "facebookexternalhit",
  "twitterbot",
  "linkedinbot",
  "slackbot",
  "telegrambot",
  "discordbot",
  "applebot",
  "pinterestbot",
  "bingbot",
  "googlebot",
  "redditbot",
  "skypeuripreview",
  "mastodon",
  "bluesky",
  "embedly",
  "iframely",
  "vkshare",
  "snap url preview",
  "zoombot",
  "google-pagerenderer",
  "kakaotalk-scrap",
  "quora link preview",
];

export function isSocialBot(userAgent: string | null): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return BOT_USER_AGENTS.some((bot) => ua.includes(bot));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The card's tags as a bare HTML page. `path` is the path the crawler asked
 * for, not the card's: og:url is what Facebook and LinkedIn re-scrape.
 * Never indexed, like the owner pages it stands in for.
 */
export function renderBotCardHtml(
  origin: string,
  path: string,
  card: CardKey,
): string {
  const { title, headline, description } = CARDS[card];
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const url = escapeHtml(`${origin}${path}`);
  const image = escapeHtml(`${origin}/api/og/${card}`);
  const alt = escapeHtml(headline);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${t}</title>
  <meta name="description" content="${d}" />
  <link rel="canonical" href="${url}" />
  <meta name="robots" content="noindex, nofollow" />
  <meta property="og:site_name" content="${SITE_NAME}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${t}" />
  <meta property="og:description" content="${d}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="${image}" />
  <meta property="og:image:secure_url" content="${image}" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="${OG_SIZE.width}" />
  <meta property="og:image:height" content="${OG_SIZE.height}" />
  <meta property="og:image:alt" content="${alt}" />
  <link rel="image_src" href="${image}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${t}" />
  <meta name="twitter:description" content="${d}" />
  <meta name="twitter:image" content="${image}" />
  <meta name="twitter:image:alt" content="${alt}" />
</head>
<body></body>
</html>`;
}

/**
 * The card page with the headers every bot answer carries. `vary:
 * user-agent` because the same URL answers a person with the app or a
 * sign-in redirect; without it a shared cache could hand them this.
 */
export function botCardResponse(html: string): NextResponse {
  return new NextResponse(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control":
        "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
      vary: "user-agent",
    },
  });
}
