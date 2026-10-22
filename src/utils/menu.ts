import type { Sells } from "types";

/*
 * The chat menu, per what the business sells. Pure and client-safe: the Today
 * page numbers its actions and sections from here, and the chat engine builds
 * its menu text and routes the owner's replies from here, so the two always
 * agree.
 */

export type MenuAction =
  | "NEW_INVOICE"
  | "NEW_RECEIPT"
  | "SHARE_LINK"
  | "UNPAID"
  | "TODAY_BOOKINGS"
  | "SUMMARY"
  | "ORDERS_TO_SEND";

export type MenuItem = { action: MenuAction; label: string };

export const MENU: Record<Sells, MenuItem[]> = {
  SERVICES: [
    { action: "NEW_INVOICE", label: "New invoice" },
    { action: "NEW_RECEIPT", label: "New receipt" },
    { action: "SHARE_LINK", label: "Share a service (booking link)" },
    { action: "UNPAID", label: "Unpaid invoices" },
    { action: "TODAY_BOOKINGS", label: "Today's bookings" },
    { action: "SUMMARY", label: "Business summary" },
  ],
  PRODUCTS: [
    { action: "NEW_INVOICE", label: "New invoice" },
    { action: "NEW_RECEIPT", label: "New receipt" },
    { action: "SHARE_LINK", label: "Share a link" },
    { action: "UNPAID", label: "Unpaid invoices" },
    { action: "ORDERS_TO_SEND", label: "Orders to send out" },
    { action: "SUMMARY", label: "Business summary" },
  ],
  BOTH: [
    { action: "NEW_INVOICE", label: "New invoice" },
    { action: "NEW_RECEIPT", label: "New receipt" },
    { action: "SHARE_LINK", label: "Share a link" },
    { action: "UNPAID", label: "Unpaid invoices" },
    { action: "TODAY_BOOKINGS", label: "Today's bookings" },
    { action: "SUMMARY", label: "Business summary" },
    { action: "ORDERS_TO_SEND", label: "Orders to send out" },
  ],
};

/** The number the chat gives an action for this business, or null if it has none. */
export function menuNumber(sells: Sells, action: MenuAction): number | null {
  const index = MENU[sells].findIndex((item) => item.action === action);
  return index === -1 ? null : index + 1;
}
