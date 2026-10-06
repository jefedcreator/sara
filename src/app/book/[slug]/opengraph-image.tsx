import { getServicePage } from "@/server";
import { pageCard, serviceCard } from "@/server/og";
import { OG_SIZE } from "@/utils/metadata";

/*
 * A booking link's share card: the service's own (server/og.tsx), the same
 * card its /services page wears. An unknown or paused link gets the site
 * card. Reads the service without availability: a card needs no slots.
 */

export const alt = "Book a time";
export const size = OG_SIZE;
export const contentType = "image/png";

type Params = { params: Promise<{ slug: string }> };

export default async function BookingOpenGraphImage({ params }: Params) {
  const { slug } = await params;
  const service = await getServicePage(slug).catch(() => null);
  return service ? serviceCard(service) : pageCard("site");
}
