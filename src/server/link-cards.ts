import { getPublicBooking } from "@/server/booking-page";
import { getSharedInvoice, getSharedReceipt } from "@/server/documents";
import {
  bookingCard,
  documentCard,
  pageCard,
  productCard,
  serviceCard,
} from "@/server/og";
import { getProductPage } from "@/server/product-page";
import { getServicePage } from "@/server/service-page";
import { bookingView } from "@/utils/booking-view";
import { appBaseUrl } from "@/utils/url";

/*
 * The share card behind each customer link, rendered once and kept a while.
 *
 * WhatsApp builds a link's preview as the message is sent: Meta fetches the
 * page, then its og:image, and only a card that arrives in time goes out
 * large; a late one leaves the small thumbnail. A card is a database read
 * from Johannesburg to Ireland plus a render, seconds together, so the chat
 * renders it here before sending the link (primeLinkCard) and the card routes
 * answer Meta from memory (linkCard).
 *
 * In memory because production is one `next start` process
 * (deploy/ecosystem.config.cjs); on globalThis because the webhook and the
 * card routes are separate bundles.
 */

export type LinkCardKind =
  | "invoice"
  | "receipt"
  | "booking"
  | "service"
  | "product";

type Card = { body: ArrayBuffer; headers: [string, string][] };
type Entry = { card: Promise<Card | null>; expires: number };

/** Outlasts any unfurl; short enough that a card catches up with a payment. */
const TTL_MS = 10 * 60 * 1000;

const store = ((globalThis as { saraLinkCards?: Map<string, Entry> })
  .saraLinkCards ??= new Map<string, Entry>());

/** The path segments with a card, and the card each wears. /book shares the service's. */
const SEGMENTS = new Map<string, LinkCardKind>([
  ["invoices", "invoice"],
  ["receipts", "receipt"],
  ["bookings", "booking"],
  ["services", "service"],
  ["book", "service"],
  ["products", "product"],
]);

/** A card's response, or null for a link that leads nowhere. */
const RENDER: Record<LinkCardKind, (id: string) => Promise<Response | null>> = {
  invoice: async (id) => {
    const doc = await getSharedInvoice(id);
    return doc && documentCard(doc);
  },
  receipt: async (id) => {
    const doc = await getSharedReceipt(id);
    return doc && documentCard(doc);
  },
  booking: async (id) => {
    const booking = await getPublicBooking(id);
    return booking && bookingCard(booking, bookingView(booking));
  },
  service: async (slug) => {
    const service = await getServicePage(slug);
    return service && serviceCard(service);
  },
  product: async (slug) => {
    const product = await getProductPage(slug);
    return product && productCard(product);
  },
};

async function render(kind: LinkCardKind, id: string): Promise<Card | null> {
  const response = await RENDER[kind](id);
  if (!response) return null;
  return { body: await response.arrayBuffer(), headers: [...response.headers] };
}

/**
 * The card from memory while it's fresh, else a render, kept. `fresh` skips
 * memory. A render in flight is the entry, so requests that arrive together
 * share it. A link that leads nowhere, or a failed read, isn't kept.
 */
function cached(kind: LinkCardKind, id: string, fresh = false) {
  const key = `${kind}:${id}`;
  const now = Date.now();
  const hit = store.get(key);
  if (hit && !fresh && hit.expires > now) return hit.card;

  for (const [k, entry] of store) if (entry.expires <= now) store.delete(k);
  const entry: Entry = { card: render(kind, id), expires: now + TTL_MS };
  store.set(key, entry);
  const forget = () => {
    if (store.get(key) === entry) store.delete(key);
  };
  entry.card.then((card) => card ?? forget(), forget);
  return entry.card;
}

/**
 * A customer link's card for its opengraph-image route. The site card for a
 * link that leads nowhere or a read that failed, as the pages' 404s wear.
 */
export async function linkCard(kind: LinkCardKind, id: string): Promise<Response> {
  const card = await cached(kind, id).catch(() => null);
  if (!card) return pageCard("site");
  return new Response(card.body.slice(0), { headers: card.headers });
}

/** The card a link wears when it's a Sara customer link: ".../invoices/X" is invoice X. */
export function cardFor(url: string): { kind: LinkCardKind; id: string } | null {
  try {
    const { origin, pathname } = new URL(url);
    if (origin !== new URL(appBaseUrl()).origin) return null;
    const [segment, id, ...rest] = pathname.split("/").filter(Boolean);
    const kind = segment && SEGMENTS.get(segment);
    if (!kind || !id || rest.length > 0) return null;
    return { kind, id: decodeURIComponent(id) };
  } catch {
    return null;
  }
}

/**
 * Render the card behind `url` now, when it's a Sara customer link, so it's
 * in memory by the time Meta asks for it. Always afresh: the chat sends a
 * link right after making or changing what it shows. Waits at most
 * `timeoutMs` (the render carries on and is kept) and never throws.
 */
export async function primeLinkCard(url: string, timeoutMs = 8000): Promise<void> {
  const target = cardFor(url);
  if (!target) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs)));
  try {
    await Promise.race([cached(target.kind, target.id, true), timeout]);
  } catch (error) {
    console.warn(`[link-cards] could not render the card for ${url}:`, error);
  } finally {
    clearTimeout(timer);
  }
}
