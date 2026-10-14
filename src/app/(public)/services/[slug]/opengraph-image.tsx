import { linkCard } from "@/server/link-cards";
import { OG_SIZE } from "@/utils/metadata";

/*
 * A service page's share card: the same card as its booking link, a JPEG
 * since it can carry a photo (server/og.tsx). Kept in memory, and rendered
 * before the chat sends the link (server/link-cards.ts).
 */

export const alt = "Book a time";
export const size = OG_SIZE;
export const contentType = "image/jpeg";

type Params = { params: Promise<{ slug: string }> };

export default async function ServiceOpenGraphImage({ params }: Params) {
  const { slug } = await params;
  return linkCard("service", slug);
}
