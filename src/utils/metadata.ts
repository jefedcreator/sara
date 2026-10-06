import type { Metadata } from "next";

import { CARDS, OG_SIZE, SITE_NAME, type CardKey } from "@/utils/cards";
import { appBaseUrl } from "@/utils/url";

export {
  CARDS,
  OG_SIZE,
  SITE_NAME,
  destinationCard,
  isCardKey,
  type CardKey,
} from "@/utils/cards";

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

/** The preview of a customer link that leads nowhere: mistyped, removed or out of date. */
export function linkNotFoundMetadata(path: string): Metadata {
  return pageMetadata({
    title: "Link not found · Sara",
    description:
      "This link is wrong or no longer works. Ask the business to send it again.",
    path,
    index: false,
  });
}

