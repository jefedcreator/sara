import { linkCard } from "@/server/link-cards";
import { OG_SIZE } from "@/utils/metadata";

/*
 * A booking link's share card: its date as a calendar leaf. Unknown ids get
 * the site card. Kept in memory (server/link-cards.ts).
 */

export const alt = "Your booking";
export const size = OG_SIZE;
export const contentType = "image/png";

type Params = { params: Promise<{ publicId: string }> };

export default async function BookingPublicOpenGraphImage({ params }: Params) {
  const { publicId } = await params;
  return linkCard("booking", publicId);
}
