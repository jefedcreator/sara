/*
 * The paths of the customers' pages. Pure and client-safe: owner rows build
 * links from these and a base URL the server hands them; server/share.ts
 * builds the absolute links Sara sends. Invoices, receipts and bookings are
 * reached by their random publicId, never their guessable slug; services
 * are public by slug.
 */

export type PublicKind = "invoice" | "receipt" | "booking";

const SEGMENT: Record<PublicKind, string> = {
  invoice: "invoices",
  receipt: "receipts",
  booking: "bookings",
};

/** "/invoices/Xk39fjQ2aB7mN0pR". */
export function publicPath(kind: PublicKind, publicId: string) {
  return `/${SEGMENT[kind]}/${encodeURIComponent(publicId)}`;
}

/** "/services/acme-braids". */
export function servicePath(slug: string) {
  return `/services/${encodeURIComponent(slug)}`;
}
