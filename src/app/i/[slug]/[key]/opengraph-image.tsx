import { getSharedInvoice } from "@/server";
import { documentCard, pageCard } from "@/server/og";
import { OG_SIZE } from "@/utils/metadata";

/*
 * A invoice link's share card: the document as the customer will find it.
 * A bad key or unknown invoice gets the site card, same as the page's 404.
 */

export const alt = "Invoice";
export const size = OG_SIZE;
export const contentType = "image/png";

type Params = { params: Promise<{ slug: string; key: string }> };

export default async function InvoiceOpenGraphImage({ params }: Params) {
  const { slug, key } = await params;
  const doc = await getSharedInvoice(slug, key).catch(() => null);
  return doc ? documentCard(doc) : pageCard("site");
}
