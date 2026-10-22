import { linkCard } from "@/server/link-cards";
import { OG_SIZE } from "@/utils/metadata";

/*
 * A product page's share card: the first photo, the price and the one action.
 * Kept in memory, and rendered before the chat sends the link
 * (server/link-cards.ts).
 */

export const alt = "View product";
export const size = OG_SIZE;
export const contentType = "image/jpeg";

type Params = { params: Promise<{ slug: string }> };

export default async function ProductOpenGraphImage({ params }: Params) {
  const { slug } = await params;
  return linkCard("product", slug);
}
