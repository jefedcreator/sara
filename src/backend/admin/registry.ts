import { nameKey } from "@/backend/services/customer/normalize";
import { type AdminRegistry, resolveRegistry } from "./kit/policy";
import type { ResolvedRegistry } from "./kit/types";

// Spec §7.2, the Sara table: what /api/admin exposes, and why anything isn't.
// A Prisma model that is neither listed here nor excluded fails registry.test.
// Fields matching the secret pattern (the Google Calendar tokens on a
// business, `token` on a chat link, the Auth.js account tokens, a session's
// `sessionToken`) are hidden by the kit itself, so nothing here lists them.

const TOTALS_NOTE = "Totals aren't recomputed from lines or payments.";

/**
 * Keeps `Customer.nameKey` in step with `name`. Sara writes the key whenever
 * it writes a name, and customer matching reads it, so a name written here
 * without it would stop matching. Applies only when the body sets `name`.
 */
function setNameKey(data: Record<string, unknown>): Record<string, unknown> {
  return typeof data.name === "string"
    ? { ...data, nameKey: nameKey(data.name) }
    : data;
}

export const adminRegistry: AdminRegistry = {
  product: "sara",
  resources: [
    {
      key: "users",
      model: "User",
      group: "People",
      title: "email",
    },
    {
      key: "businesses",
      model: "Business",
      group: "Businesses",
      title: "name",
    },
    {
      key: "business-hours",
      model: "BusinessHours",
      group: "Businesses",
      title: "dayOfWeek",
    },
    {
      key: "business-closures",
      model: "BusinessClosure",
      group: "Businesses",
      title: "date",
    },
    {
      key: "services",
      model: "Service",
      group: "Catalogue",
      title: "name",
    },
    {
      key: "products",
      model: "Product",
      group: "Catalogue",
      title: "name",
    },
    {
      key: "product-options",
      model: "ProductOption",
      group: "Catalogue",
      title: "name",
    },
    {
      key: "gallery-items",
      model: "GalleryItem",
      group: "Catalogue",
      title: "url",
    },
    {
      key: "customers",
      model: "Customer",
      group: "Customers",
      title: "name",
      readOnly: ["nameKey"],
      hooks: { beforeWrite: setNameKey },
    },
    {
      key: "bookings",
      model: "Booking",
      group: "Sales",
      title: "clientName",
    },
    {
      key: "invoices",
      model: "Invoice",
      group: "Sales",
      title: "invoiceNumber",
      note: TOTALS_NOTE,
    },
    {
      key: "invoice-lines",
      model: "InvoiceLine",
      group: "Sales",
      title: "name",
      note: TOTALS_NOTE,
    },
    {
      key: "receipts",
      model: "Receipt",
      group: "Sales",
      title: "receiptNumber",
      note: TOTALS_NOTE,
    },
    {
      key: "receipt-lines",
      model: "ReceiptLine",
      group: "Sales",
      title: "name",
      note: TOTALS_NOTE,
    },
    {
      key: "orders",
      model: "Order",
      group: "Sales",
      title: "clientName",
      note: TOTALS_NOTE,
    },
    {
      key: "order-lines",
      model: "OrderLine",
      group: "Sales",
      title: "name",
      note: TOTALS_NOTE,
    },
    {
      key: "payments",
      model: "Payment",
      group: "Sales",
      title: "clientName",
      note: "Changes this record only. Paystack isn't contacted.",
    },
    {
      key: "chat-identities",
      model: "ChatIdentity",
      group: "Chat",
      title: "externalId",
    },
    {
      key: "chat-sessions",
      model: "ChatSession",
      group: "Chat",
      title: "state",
      note: "Live chat state. Editing it changes what Sara does next in that chat.",
    },
    {
      key: "chat-link-tokens",
      model: "ChatLinkToken",
      group: "Sign-in",
      title: "externalId",
      signIn: true,
    },
    {
      key: "accounts",
      model: "Account",
      group: "Sign-in",
      title: "provider",
      signIn: true,
      hidden: ["session_state"],
    },
    {
      key: "sessions",
      model: "Session",
      group: "Sign-in",
      title: "userId",
      signIn: true,
    },
  ],
  excluded: {
    VerificationToken: "Sign-in tokens with no single id.",
  },
};

export const resolvedAdmin: ResolvedRegistry = resolveRegistry(adminRegistry);
