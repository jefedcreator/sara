import { getSharedReceipt } from "@/server";
import { documentCard, pageCard } from "@/server/og";
import { OG_SIZE } from "@/utils/metadata";

/*
 * A receipt link's share card: the document as the customer will find it.
 * An unknown id gets the site card, same as the page's 404.
 */

export const alt = "Receipt";
export const size = OG_SIZE;
export const contentType = "image/png";

type Params = { params: Promise<{ publicId: string }> };

export default async function ReceiptOpenGraphImage({ params }: Params) {
  const { publicId } = await params;
  const doc = await getSharedReceipt(publicId).catch(() => null);
  return doc ? documentCard(doc) : pageCard("site");
}
