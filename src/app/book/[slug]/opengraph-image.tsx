import { linkCard } from "@/server/link-cards";
import { OG_SIZE } from "@/utils/metadata";

/*
 * A booking link's share card: the service's own (server/og.tsx), the same
 * card its /services page wears, and a JPEG since it can carry a photo. An
 * unknown or paused link gets the site card. Reads the service without
 * availability: a card needs no slots. Kept in memory (server/link-cards.ts).
 */

export const alt = "Book a time";
export const size = OG_SIZE;
export const contentType = "image/jpeg";

type Params = { params: Promise<{ slug: string }> };

export default async function BookingOpenGraphImage({ params }: Params) {
  const { slug } = await params;
  return linkCard("service", slug);
}
