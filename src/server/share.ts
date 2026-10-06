import { publicPath, servicePath, type PublicKind } from "@/utils/public-links";
import { appBaseUrl } from "@/utils/url";

/*
 * The absolute links Sara hands out: chat replies, emails, API responses.
 * Invoices, receipts and bookings are reached by their random publicId
 * (prisma/schema.prisma), never their guessable slug; services are public by
 * slug. Paths alone, for client code, live in utils/public-links.ts.
 */

export { publicPath, servicePath, type PublicKind };

/** "https://app.sara.ng/invoices/Xk39fjQ2aB7mN0pR". */
export function publicLink(kind: PublicKind, publicId: string) {
  return `${appBaseUrl()}${publicPath(kind, publicId)}`;
}

/** "https://app.sara.ng/services/acme-braids". */
export function serviceLink(slug: string) {
  return `${appBaseUrl()}${servicePath(slug)}`;
}
