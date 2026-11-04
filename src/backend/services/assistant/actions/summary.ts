import type { Prisma } from "@prisma/client";

import { formatMoney } from "@/backend/services/messaging/engine/amount";

import type { DraftRequestKind } from "./schemas";
import type { ResolvedPayloadByKind } from "./types";

/** Leaves room for a 200-character voice transcript and the approval prompt. */
export const MAX_APPROVAL_SUMMARY_CHARS = 3_700;

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as ObjectValue : {};
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("ASSISTANT_SUMMARY_METADATA_MISSING");
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error("ASSISTANT_SUMMARY_INVALID_AMOUNT");
  return value;
}
function money(value: unknown, currency: string): string {
  return formatMoney(integer(value) / 100, currency);
}
function date(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("ASSISTANT_SUMMARY_INVALID_DATE");
  const parsed = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error("ASSISTANT_SUMMARY_INVALID_DATE");
  return parsed.toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "long", year: "numeric" });
}
function time(value: unknown): string {
  const parsed = new Date(text(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error("ASSISTANT_SUMMARY_INVALID_DATE");
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(parsed);
  const part = (kind: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === kind)!.value;
  return `${part("day")} ${part("month")} ${part("year")}, ${part("hour")}:${part("minute")} WAT`;
}
function title(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }
function field(label: string, value: unknown): string { return `${label}: ${value === null ? "Clear" : text(value)}`; }
function contact(customer: ObjectValue): string[] {
  return ["phone", "email", "address"].flatMap((key) => typeof customer[key] === "string" && customer[key] ? [field(title(key), customer[key])] : []);
}
function customerCreation(customer: unknown, snapshot: ObjectValue): string[] {
  if (!snapshot.customerWillBeCreated) return [];
  const c = object(customer);
  return [`Create customer: ${text(c.name)}.`];
}
function payment(method: string): string {
  if (method === "CASH") return "cash";
  if (method === "BANK_TRANSFER") return "bank transfer";
  throw new Error("ASSISTANT_SUMMARY_INVALID_METHOD");
}
function stock(snapshot: ObjectValue, lines: Array<{ name: string; productOptionId: string | null }>): string[] {
  const before = object(snapshot.stockBefore);
  const after = object(snapshot.stockAfter);
  return [...new Set(lines.map((line) => line.productOptionId).filter((id): id is string => id !== null))].map((id) => {
    const name = lines.find((line) => line.productOptionId === id)!.name;
    if (!(id in before) || !(id in after)) throw new Error("ASSISTANT_SUMMARY_METADATA_MISSING");
    return before[id] === null && after[id] === null
      ? `Stock · ${name}: not tracked.`
      : `Stock · ${name}: ${integer(before[id])} → ${integer(after[id])}.`;
  });
}
function lineItems(lines: ResolvedPayloadByKind["create_invoice"]["lines"], currency: string, snapshot: ObjectValue): string[] {
  const requestLines = object(snapshot.originalRequest).lines;
  const catalogLines = snapshot.catalogLines;
  return lines.flatMap((line, index) => {
    const override = Array.isArray(catalogLines)
      ? catalogLines.some((value) => { const source = object(value); return source.kind === line.kind && source.id === line.id && source.unitPriceMinor === line.unitPriceMinor && source.priceSource === "owner"; })
      : Array.isArray(requestLines) && object(requestLines[index]).priceOverride !== null && object(requestLines[index]).priceOverride !== undefined;
    return [
      `${integer(line.quantity)} × ${line.name} · ${money(line.unitPriceMinor, currency)} each · ${money(line.totalMinor, currency)}${override ? " (owner price override)" : ""}`,
      ...(line.description ? [`Description · ${line.name}: ${line.description}`] : []),
    ];
  });
}
function totals(p: ResolvedPayloadByKind["create_invoice"] | ResolvedPayloadByKind["create_receipt"]): string[] {
  return [
    ...(p.taxAmountMinor || p.discountMinor ? [`Subtotal: ${money(p.subtotalMinor, p.currency)}`, `Tax: ${money(p.taxAmountMinor, p.currency)}`, `Discount: ${money(p.discountMinor, p.currency)}`] : []),
    `Total: ${money(p.totalMinor, p.currency)}`,
  ];
}
function productOptions(options: ResolvedPayloadByKind["create_product"]["options"], currency: string, tracksStock: boolean): string[] {
  return options.map((option) => `Option: ${option.name || "Default"} · ${option.priceMinor === null ? "base price" : money(option.priceMinor, currency)} · ${tracksStock ? `stock ${integer(option.stock)}` : "stock not tracked"}`);
}
function restock(snapshot: ObjectValue): string[] {
  const lines = snapshot.restockLines;
  if (!Array.isArray(lines)) throw new Error("ASSISTANT_SUMMARY_METADATA_MISSING");
  const grouped = new Map<string, { name: string; quantity: number }>();
  for (const value of lines) {
    const line = object(value);
    const id = text(line.productOptionId);
    grouped.set(id, { name: text(line.name), quantity: integer(integer(line.quantity) + (grouped.get(id)?.quantity ?? 0)) });
  }
  return grouped.size ? [...grouped].map(([id, line]) => {
    if (object(snapshot.stockBefore)[id] === null && object(snapshot.stockAfter)[id] === null) return `Stock · ${line.name}: not tracked.`;
    return `Restock · ${line.name}: +${line.quantity} (${integer(object(snapshot.stockBefore)[id])} → ${integer(object(snapshot.stockAfter)[id])}).`;
  }) : ["No tracked stock to return."];
}
function email(label: string, value: unknown): string[] {
  return typeof value === "string" && value ? [`${label}: ${value}.`] : [];
}

/** All words describing mutations are authored here, never supplied by a model. */
export function renderSummary<K extends DraftRequestKind>(
  kind: K,
  payload: ResolvedPayloadByKind[K] | Prisma.InputJsonObject,
  savedSnapshot: Prisma.InputJsonObject,
): string {
  const s = object(savedSnapshot);
  const currency = () => text(s.businessCurrency);
  let output: string[];
  switch (kind) {
    case "create_invoice": {
      const p = payload as ResolvedPayloadByKind["create_invoice"];
      output = [`Create an invoice for ${p.customer.name}?`, ...lineItems(p.lines, p.currency, s), ...totals(p), `Due: ${p.dueDate ? date(p.dueDate) : "No due date"}`, ...(p.notes ? [`Notes: ${p.notes}`] : []), ...customerCreation(p.customer, s), ...contact(object(p.customer)), "Create an unpaid invoice. Stock is unchanged."];
      break;
    }
    case "create_receipt": {
      const p = payload as ResolvedPayloadByKind["create_receipt"];
      const products = p.lines.some((line) => line.productOptionId !== null);
      output = [`Record a sale for ${p.customer?.name ?? "Customer"}?`, ...lineItems(p.lines, p.currency, s), ...totals(p), `Paid ${payment(p.method)}${p.fulfilment ? ` · ${p.fulfilment === "PICKUP" ? "Pickup" : "Delivery"}` : ""}`, `Amount paid: ${money(p.amountPaidMinor, p.currency)}`, ...(p.fulfilment === "DELIVERY" ? [`Delivery fee: ${money(s.deliveryFeeMinor, p.currency)}`] : []), ...(p.deliveryAddress ? [`Delivery address: ${p.deliveryAddress}`] : []), ...(p.notes ? [`Notes: ${p.notes}`] : []), ...customerCreation(p.customer, s), ...contact(object(p.customer)), products ? `Create a receipt and ${p.fulfilment === "PICKUP" ? "completed pickup" : "new delivery"} order.` : "Create a receipt. Stock is unchanged.", ...(products ? stock(s, p.lines) : []), ...(s.receiptEmailWillBeSent ? email("Email receipt to", object(p.customer).email) : [])];
      break;
    }
    case "record_invoice_payment": {
      const p = payload as ResolvedPayloadByKind["record_invoice_payment"];
      output = [`Record payment for invoice ${text(s.invoiceNumber)} · ${text(s.clientName)}?`, `Payment: ${money(p.amountMinor, p.currency)} · ${payment(p.method)}`, `Outstanding: ${money(s.outstandingMinor, p.currency)} → ${money(integer(s.outstandingMinor) - p.amountMinor, p.currency)}`, p.createReceipt ? "Create a receipt for this payment." : "Do not create a receipt.", ...(s.invoiceEmailWillBeSent ? email("Email updated invoice to", s.clientEmail) : []), ...(p.createReceipt && s.receiptEmailWillBeSent ? email("Email receipt to", s.clientEmail) : [])];
      if (s.createsOrder) output.push("Create a new pickup order.", ...stock(s, s.productLines as Array<{ name: string; productOptionId: string }>));
      else output.push("Stock is unchanged.");
      break;
    }
    case "void_invoice": {
      const p = payload as ResolvedPayloadByKind["void_invoice"];
      const order = object(s.orderInfo);
      output = [`Void invoice ${text(s.invoiceNumber)} · ${text(s.clientName)}?`, "Mark the invoice void.", ...(p.cancelOrder && order.id ? [`Cancel order ${text(order.orderNumber ?? order.slug)}.`, ...restock(order), ...email("Email order cancellation to", order.clientEmail)] : ["Orders and stock are unchanged."]), ...(s.invoiceEmailWillBeSent ? email("Email updated invoice to", s.clientEmail) : [])];
      break;
    }
    case "update_order": {
      const p = payload as ResolvedPayloadByKind["update_order"];
      output = [`Update order ${text(s.orderNumber)}?`, `Status: ${text(s.currentStatus)} → ${p.status}`, ...(p.status === "CANCELLED" ? restock(s) : ["Stock is unchanged."]), ...email("Email order update to", s.clientEmail)];
      break;
    }
    case "adjust_stock": {
      const p = payload as ResolvedPayloadByKind["adjust_stock"];
      output = [`Adjust stock for ${text(s.productName)}${s.optionName ? ` · ${text(s.optionName)}` : ""}?`, `${p.mode === "set" ? "Set stock to" : p.mode === "add" ? "Add" : "Remove"}: ${integer(p.quantity)}`, `Stock: ${integer(p.previousStock)} → ${integer(p.newStock)}`];
      break;
    }
    case "update_booking": {
      const p = payload as ResolvedPayloadByKind["update_booking"];
      output = [`Update booking for ${text(s.serviceName)}?`, `Current time: ${time(s.currentStartTime)} → ${time(s.currentEndTime)}`, ...(p.status ? [`Status: ${text(s.currentStatus)} → ${p.status}`] : []), ...(p.startTime ? [`New time: ${time(p.startTime)} → ${time(p.endTime)}`] : []), `Units: ${integer(p.units)}`, ...(s.emailWillBeSent ? email("Email booking update to", s.clientEmail) : []), ...(s.calendarSyncNeeded && s.calendarEventExists ? [p.status === "CANCELLED" ? "Remove the booking from Google Calendar." : "Sync the booking to Google Calendar."] : ["Google Calendar is unchanged."])];
      break;
    }
    case "create_product": {
      const p = payload as ResolvedPayloadByKind["create_product"];
      output = [`Create product ${p.name}?`, `Base price: ${money(p.priceMinor, currency())}`, ...(p.description ? [`Description: ${p.description}`] : []), `Track stock: ${p.tracksStock ? "Yes" : "No"}`, ...productOptions(p.options, currency(), p.tracksStock)];
      break;
    }
    case "update_product": {
      const p = payload as ResolvedPayloadByKind["update_product"];
      output = [`Update product ${text(s.productName)}?`];
      for (const key of ["name", "description", "priceMinor", "isActive", "tracksStock", "options"] as const) {
        const fieldName = key === "priceMinor" ? "price" : key;
        if (!p.fields.includes(fieldName)) continue;
        if (key === "priceMinor") output.push(`Base price: ${money(s.currentPrice, currency())} → ${money(p.priceMinor, currency())}`);
        else if (key === "isActive") output.push(`Active: ${p.isActive ? "Yes" : "No"}`);
        else if (key === "tracksStock") output.push(`Track stock: ${p.tracksStock ? "Yes" : "No"}`);
        else if (key === "options") {
          if (!p.options) throw new Error("ASSISTANT_SUMMARY_METADATA_MISSING");
          output.push("Replace product options with:", ...productOptions(p.options, currency(), p.tracksStock ?? s.tracksStock === true));
          if (Array.isArray(s.existingOptions)) for (const value of s.existingOptions) {
            const existing = object(value);
            if (!p.options.some((option) => option.optionId === existing.id)) output.push(`Deactivate option: ${existing.name === "" ? "Default" : text(existing.name)}.`);
          }
        }
        else output.push(field(title(key), p[key]));
      }
      break;
    }
    case "create_service": {
      const p = payload as ResolvedPayloadByKind["create_service"];
      output = [`Create service ${p.name}?`, `Price: ${money(p.priceMinor, currency())}`, ...(p.description ? [`Description: ${p.description}`] : []), `Duration: ${integer(p.duration)} minutes`, `Booking mode: ${p.bookingMode}`, `Availability: ${p.availableFrom} → ${p.availableTo} WAT`, `Check-in: ${p.checkInTime ?? "None"}`, `Check-out: ${p.checkOutTime ?? "None"}`, `Units: ${integer(p.minUnits)} → ${integer(p.maxUnits)}`];
      break;
    }
    case "update_service": {
      const p = payload as ResolvedPayloadByKind["update_service"];
      output = [`Update service ${text(s.serviceName)}?`];
      const labels = { name: "Name", description: "Description", duration: "Duration (minutes)", bookingMode: "Booking mode", availableFrom: "Available from (WAT)", availableTo: "Available to (WAT)", checkInTime: "Check-in (WAT)", checkOutTime: "Check-out (WAT)", minUnits: "Minimum units", maxUnits: "Maximum units" } as const;
      for (const key of Object.keys(labels) as Array<keyof typeof labels>) {
        if (p.fields.includes(key)) output.push(`${labels[key]}: ${p[key] === null ? "Clear" : p[key]}`);
      }
      if (p.fields.includes("price")) output.push(`Price: ${money(s.currentPrice, currency())} → ${money(p.priceMinor, currency())}`);
      if (p.fields.includes("isActive")) output.push(`Active: ${p.isActive ? "Yes" : "No"}`);
      break;
    }
    case "create_customer": {
      const p = payload as ResolvedPayloadByKind["create_customer"];
      output = [`Create customer ${p.name}?`, ...contact(object(p)), ...(p.notes ? [`Notes: ${p.notes}`] : [])];
      break;
    }
    case "update_customer": {
      const p = payload as ResolvedPayloadByKind["update_customer"];
      output = [`Update customer ${text(s.customerName)}?`];
      for (const key of ["name", "phone", "email", "address", "notes"] as const) {
        if (p.fields.includes(key)) output.push(field(title(key), p[key]));
      }
      break;
    }
    default: throw new Error("ASSISTANT_SUMMARY_UNKNOWN_KIND");
  }
  const summary = output.join("\n");
  if (summary.length > MAX_APPROVAL_SUMMARY_CHARS) throw Object.assign(new Error("Please split this request into smaller actions so every detail fits in the approval preview."), { code: "ASSISTANT_PREVIEW_TOO_LONG" });
  return summary;
}
