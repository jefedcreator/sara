import { pageCard } from "@/server/og";
import { CARDS, OG_SIZE } from "@/utils/metadata";

/*
 * The site's share card: the landing page's, and the fallback for any route
 * without its own (booking links and document links fall back to it too
 * when theirs can't be shown).
 */

export const alt = CARDS.site.headline;
export const size = OG_SIZE;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return pageCard("site");
}
