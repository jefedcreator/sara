import { linkCard } from "@/server/link-cards";
import { OG_SIZE } from "@/utils/metadata";

/*
 * A receipt link's share card: the document as the customer will find it.
 * An unknown id gets the site card, same as the page's 404. Kept in memory,
 * and rendered before the chat sends the link (server/link-cards.ts).
 */

export const alt = "Receipt";
export const size = OG_SIZE;
export const contentType = "image/png";

type Params = { params: Promise<{ publicId: string }> };

export default async function ReceiptOpenGraphImage({ params }: Params) {
  const { publicId } = await params;
  return linkCard("receipt", publicId);
}
