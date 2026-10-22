/*
 * The fixed link-preview cards, and which one an owner-only path wears.
 * No env and no server imports: the middleware reads this on the Edge to
 * answer link crawlers (utils/bot-card.ts), and pages read it through
 * utils/metadata.ts.
 */

export const SITE_NAME = "Sara";

/** 875×875: the square every interacti product's card shares. */
export const OG_SIZE = { width: 875, height: 875 } as const;

/**
 * The fixed cards for pages whose preview says what the page is rather than
 * what is on it. Served by /api/og/[card] from this list only, so the route
 * can't be made to render arbitrary text under Sara's name.
 *
 * `title` and `description` are the tab and link-preview text; `headline` is
 * the big line on the image, whose body is `description`. Keep descriptions
 * to two card lines (about 110 characters).
 */
export const CARDS = {
  site: {
    title: "Sara · Run your business from WhatsApp",
    headline: "The admin side of your business, handled.",
    description:
      "Invoices, receipts, booking links and today's numbers, for small service businesses.",
  },
  signin: {
    title: "Sign in · Sara",
    headline: "Sign in to Sara.",
    description:
      "Run your business from the web: invoices, receipts, bookings and today's numbers.",
  },
  link: {
    title: "Connect your chat · Sara",
    headline: "Connect your chat to Sara.",
    description:
      "Link it once, and your WhatsApp or Instagram chat can send invoices, booking links and today's numbers.",
  },
  onboarding: {
    title: "Set up your business · Sara",
    headline: "Set up your business.",
    description:
      "Your business name and the bank account payments settle into. It takes about two minutes.",
  },
  dashboard: {
    title: "Today · Sara",
    headline: "Today's numbers.",
    description: "Revenue, today's bookings and unpaid invoices, at a glance.",
  },
  bookings: {
    title: "Bookings · Sara",
    headline: "Your bookings.",
    description: "Every appointment booked through your links, day by day.",
  },
  customers: {
    title: "Customers · Sara",
    headline: "Your customers.",
    description:
      "Everyone who books, buys or gets an invoice, with what they've spent and still owe.",
  },
  invoices: {
    title: "Invoices · Sara",
    headline: "Your invoices.",
    description: "What's been sent, what's been paid and what's still owed.",
  },
  receipts: {
    title: "Receipts · Sara",
    headline: "Your receipts.",
    description: "Proof of every payment you've taken, ready to resend.",
  },
  services: {
    title: "Services · Sara",
    headline: "Your services and booking links.",
    description:
      "Prices, lengths and the links customers book and pay through.",
  },
  products: {
    title: "Products · Sara",
    headline: "Your products and links.",
    description:
      "Photos, prices and stock, with a link customers order through.",
  },
  orders: {
    title: "Orders · Sara",
    headline: "Your orders.",
    description:
      "What's been paid, what to send out and what's already done.",
  },
  settings: {
    title: "Settings · Sara",
    headline: "Business settings.",
    description:
      "Opening hours, closures, your calendar and where payments settle.",
  },
  docs: {
    title: "API reference · Sara",
    headline: "Sara API reference.",
    description: "Every endpoint behind the app and the chat.",
  },
} as const;

export type CardKey = keyof typeof CARDS;

export function isCardKey(value: string): value is CardKey {
  return Object.hasOwn(CARDS, value);
}

/**
 * Owner-only paths, by first segment, and the card each previews with. A
 * signed-out visitor never reaches these pages, so their preview comes from
 * here instead: the middleware answers link crawlers with it directly, and
 * /signin?next= wears it for any crawler that follows the redirect.
 */
const DESTINATION_CARDS: Record<string, CardKey> = {
  dashboard: "dashboard",
  bookings: "bookings",
  customers: "customers",
  invoices: "invoices",
  receipts: "receipts",
  services: "services",
  products: "products",
  orders: "orders",
  settings: "settings",
  onboarding: "onboarding",
  link: "link",
};

/** The card for an owner-only path ("/invoices", "/settings?calendar=1"), or null. */
export function destinationCard(path: string): CardKey | null {
  const segment = path.split(/[/?#]/)[1] ?? "";
  return Object.hasOwn(DESTINATION_CARDS, segment)
    ? DESTINATION_CARDS[segment]!
    : null;
}
