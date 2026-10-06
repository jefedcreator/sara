import { getServicePage } from "@/server";
import { pageCard, serviceCard } from "@/server/og";
import { OG_SIZE } from "@/utils/metadata";

/* A service page's share card: the same card as its booking link. */

export const alt = "Book a time";
export const size = OG_SIZE;
export const contentType = "image/png";

type Params = { params: Promise<{ slug: string }> };

export default async function ServiceOpenGraphImage({ params }: Params) {
  const { slug } = await params;
  const page = await getServicePage(slug).catch(() => null);
  return page ? serviceCard(page) : pageCard("site");
}
