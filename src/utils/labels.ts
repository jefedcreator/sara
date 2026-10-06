/*
 * Literal product language for record states (DESIGN.md: "Unpaid, Partially
 * paid, Paid"), with the StatusPill tone each wears. Green (accent) only for
 * settled money and confirmed bookings; danger only for overdue.
 */

type Tone = "accent" | "muted" | "danger";

export const INVOICE_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "muted" },
  SENT: { label: "Unpaid", tone: "muted" },
  PARTIALLY_PAID: { label: "Partially paid", tone: "accent" },
  PAID: { label: "Paid", tone: "accent" },
  OVERDUE: { label: "Overdue", tone: "danger" },
  VOID: { label: "Void", tone: "muted" },
};

export const BOOKING_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "Awaiting payment", tone: "muted" },
  CONFIRMED: { label: "Confirmed", tone: "accent" },
  COMPLETED: { label: "Done", tone: "muted" },
  CANCELLED: { label: "Cancelled", tone: "muted" },
};

export const PAYMENT_METHOD: Record<string, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  PAYSTACK: "Paystack",
  STRIPE: "Card",
};

/**
 * A real instant (a hold's expiry) as a Lagos time: "14:32". Not for slot
 * times, which are wall-clock written as UTC (formatSlotTime in utils/format).
 */
export function formatClock(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Africa/Lagos",
  }).format(new Date(iso));
}

/** A real instant (createdAt, dueAt) as a Lagos date: "29 Sep 2026". */
export function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Lagos",
  }).format(new Date(iso));
}
