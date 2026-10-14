import { linkCard } from "@/server/link-cards";
import { OG_SIZE } from "@/utils/metadata";

/*
 * An invoice link's share card: the document as the customer will find it.
 * An unknown id gets the site card, same as the page's 404. Kept in memory,
 * and rendered before the chat sends the link (server/link-cards.ts).
 */

export const alt = "Invoice";
export const size = OG_SIZE;
export const contentType = "image/png";

type Params = { params: Promise<{ publicId: string }> };

export default async function InvoiceOpenGraphImage({ params }: Params) {
  const { publicId } = await params;
  return linkCard("invoice", publicId);
}
