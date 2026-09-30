import { pageCard } from "@/server/og";
import { CARDS, isCardKey } from "@/utils/metadata";

/*
 * The fixed page cards (CARDS in utils/metadata), one per key, rendered at
 * build. Pages point at these through cardMetadata(); content cards (a
 * booking link, an invoice) are opengraph-image files next to their page.
 */

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(CARDS).map((card) => ({ card }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ card: string }> },
) {
  const { card } = await params;
  if (!isCardKey(card)) return new Response("Not found", { status: 404 });
  return pageCard(card);
}
