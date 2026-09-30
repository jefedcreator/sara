import type { Metadata } from "next";

import { appBaseUrl } from "@/utils/url";

export const SITE_NAME = "Sara";

/** 1200×630: what WhatsApp, Instagram, Facebook, X and Slack all take large. */
export const OG_SIZE = { width: 1200, height: 630 } as const;

/**
 * The fixed cards for pages whose preview says what the page is rather than
 * what is on it. Served by /api/og/[card] from this list only, so the route
 * can't be made to render arbitrary text under Sara's name.
 *
 * `title` and `description` are the tab and link-preview text; `headline` is
 * the big line on the image, whose body is `description`. Keep descriptions
 * to two card lines (about 110 characters).
 */
export const CARDS = {
  site: {
    title: "Sara · Run your business from WhatsApp",
    headline: "The admin side of your business, handled.",
    description:
      "Invoices, receipts, booking links and today's numbers, for small service businesses.",
  },
  signin: {
    title: "Sign in · Sara",
    headline: "Sign in to Sara.",
    description:
      "Run your business from the web: invoices, receipts, bookings and today's numbers.",
  },
  link: {
    title: "Connect your chat · Sara",
    headline: "Connect your chat to Sara.",
    description:
      "Link it once, and your WhatsApp or Instagram chat can send invoices, booking links and today's numbers.",
  },
  onboarding: {
    title: "Set up your business · Sara",
    headline: "Set up your business.",
    description:
      "Your business name and the bank account payments settle into. It takes about two minutes.",
  },
  dashboard: {
    title: "Today · Sara",
    headline: "Today's numbers.",
    description: "Revenue, today's bookings and unpaid invoices, at a glance.",
  },
  bookings: {
    title: "Bookings · Sara",
    headline: "Your bookings.",
    description: "Every appointment booked through your links, day by day.",
  },
  invoices: {
    title: "Invoices · Sara",
    headline: "Your invoices.",
    description: "What's been sent, what's been paid and what's still owed.",
  },
  receipts: {
    title: "Receipts · Sara",
    headline: "Your receipts.",
    description: "Proof of every payment you've taken, ready to resend.",
  },
  services: {
    title: "Services · Sara",
    headline: "Your services and booking links.",
    description:
      "Prices, lengths and the links customers book and pay through.",
  },
  settings: {
    title: "Settings · Sara",
    headline: "Business settings.",
    description:
      "Opening hours, closures, your calendar and where payments settle.",
  },
  docs: {
    title: "API reference · Sara",
    headline: "Sara API reference.",
    description: "Every endpoint behind the app and the chat.",
  },
} as const;

export type CardKey = keyof typeof CARDS;

export function isCardKey(value: string): value is CardKey {
  return Object.hasOwn(CARDS, value);
}

export type PageMetadataInput = {
  title: string;
  description: string;
  /** The route path, for the canonical URL and og:url. */
  path: string;
  /**
   * The card, when it isn't an opengraph-image file in the route's own
   * segment. Leave it out for those: the file's image is merged in.
   */
  image?: { url: string; alt: string };
  /** False for pages that belong to one owner or one customer. */
  index?: boolean;
};

/**
 * A page's title, description, canonical URL and link preview, said once.
 * Open Graph and X each need their own copy of the text, and a preview built
 * by hand tends to drop og:url or the twitter text without anyone noticing.
 */
export function pageMetadata({
  title,
  description,
  path,
  image,
  index = true,
}: PageMetadataInput): Metadata {
  const url = `${appBaseUrl()}${path}`;
  // Leave the key out entirely without an image: even `images: undefined`
  // overrides the segment's opengraph-image file.
  const images = image ? { images: [{ ...image, ...OG_SIZE }] } : {};
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      type: "website",
      ...images,
    },
    twitter: { card: "summary_large_image", title, description, ...images },
    robots: index ? undefined : { index: false, follow: false },
  };
}

/** A page previewed by one of the fixed `CARDS`. */
export function cardMetadata(
  card: CardKey,
  { path, index }: { path: string; index?: boolean },
): Metadata {
  const { title, headline, description } = CARDS[card];
  return pageMetadata({
    title,
    description,
    path,
    index,
    image: { url: `/api/og/${card}`, alt: headline },
  });
}
