import { describe, expect, it } from "vitest";

import type { Prisma } from "@prisma/client";
import type { ResolvedPayloadByKind } from "./types";
import { MAX_APPROVAL_SUMMARY_CHARS, renderSummary } from "./summary";

const customer = { id: "customer-1", name: "Amaka", phone: null, email: null, address: null };
const productLine: ResolvedPayloadByKind["create_invoice"]["lines"][number] = {
  kind: "product", id: "option-1", name: "Shea butter", description: null,
  quantity: 3, unitPriceMinor: 500000, totalMinor: 1500000,
  serviceId: null, productOptionId: "option-1",
};
const invoice: ResolvedPayloadByKind["create_invoice"] = {
  customer, lines: [productLine], dueDate: "2026-11-05", notes: null,
  subtotalMinor: 1500000, taxAmountMinor: 0, discountMinor: 0, totalMinor: 1500000, currency: "NGN",
};
const receipt: ResolvedPayloadByKind["create_receipt"] = {
  ...invoice, amountPaidMinor: 1500000, method: "CASH", fulfilment: "PICKUP", deliveryAddress: null,
};
const base: Prisma.InputJsonObject = { businessId: "biz-1", businessCurrency: "NGN", customerWillBeCreated: false };
const stocks = { stockBefore: { "option-1": 10 }, stockAfter: { "option-1": 7 } };
const restock = { restockLines: [{ productOptionId: "option-1", name: "Shea butter", quantity: 3 }], stockBefore: { "option-1": 7 }, stockAfter: { "option-1": 10 } };

describe("deterministic approval summaries", () => {
  it("shows every sale line, amount and stock/order consequence", () => {
    const payload = { ...receipt, lines: [productLine, { ...productLine, kind: "custom" as const, id: null, name: "Gift wrap", quantity: 1, unitPriceMinor: 50000, totalMinor: 50000, productOptionId: null }], subtotalMinor: 1550000, totalMinor: 1550000, amountPaidMinor: 1550000 };
    expect(renderSummary("create_receipt", payload, { ...base, ...stocks })).toBe(
      "Record a sale for Amaka?\n3 × Shea butter · NGN 5,000 each · NGN 15,000\n1 × Gift wrap · NGN 500 each · NGN 500\nTotal: NGN 15,500\nPaid cash · Pickup\nAmount paid: NGN 15,500\nCreate a receipt and completed pickup order.\nStock · Shea butter: 10 → 7.",
    );
  });

  it("shows invoice dates, owner prices and every newly written customer contact", () => {
    const payload = { ...invoice, customer: { name: "Amaka", phone: "+2348012345678", email: "amaka@example.test", address: "10 Broad Street" }, notes: "Due after collection" };
    expect(renderSummary("create_invoice", payload, { ...base, customerWillBeCreated: true, originalRequest: { lines: [{ priceOverride: { quote: "five thousand", amountMinor: 500000 } }] } })).toBe(
      "Create an invoice for Amaka?\n3 × Shea butter · NGN 5,000 each · NGN 15,000 (owner price override)\nTotal: NGN 15,000\nDue: 5 November 2026\nNotes: Due after collection\nCreate customer: Amaka.\nPhone: +2348012345678\nEmail: amaka@example.test\nAddress: 10 Broad Street\nCreate an unpaid invoice. Stock is unchanged.",
    );
  });

  it("shows the actual zero delivery fee and complete delivery address", () => {
    expect(renderSummary("create_receipt", { ...receipt, method: "BANK_TRANSFER", fulfilment: "DELIVERY", deliveryAddress: "10 Broad Street, Lagos" }, { ...base, ...stocks, deliveryFeeMinor: 0 })).toBe(
      "Record a sale for Amaka?\n3 × Shea butter · NGN 5,000 each · NGN 15,000\nTotal: NGN 15,000\nPaid bank transfer · Delivery\nAmount paid: NGN 15,000\nDelivery fee: NGN 0\nDelivery address: 10 Broad Street, Lagos\nCreate a receipt and new delivery order.\nStock · Shea butter: 10 → 7.",
    );
  });

  it("uses resolved catalog provenance after duplicate request lines were merged", () => {
    expect(renderSummary("create_invoice", invoice, { ...base,
      originalRequest: { lines: [{ priceOverride: null }, { priceOverride: { quote: "five thousand", amountMinor: 500000 } }] },
      catalogLines: [
        { kind: "product", id: "option-1", unitPriceMinor: 500000, priceSource: "catalog" },
        { kind: "product", id: "option-1", unitPriceMinor: 500000, priceSource: "owner" },
      ],
    })).toBe("Create an invoice for Amaka?\n3 × Shea butter · NGN 5,000 each · NGN 15,000 (owner price override)\nTotal: NGN 15,000\nDue: 5 November 2026\nCreate an unpaid invoice. Stock is unchanged.");
  });

  it("shows invoice payment, optional receipt and first-payment order stock", () => {
    const p: ResolvedPayloadByKind["record_invoice_payment"] = { invoiceId: "invoice-1", amountMinor: 500000, method: "BANK_TRANSFER", createReceipt: true, currency: "NGN" };
    const s = { ...base, ...stocks, invoiceNumber: "INV-7", clientName: "Amaka", outstandingMinor: 1500000, createsOrder: true, productLines: [productLine], clientEmail: "amaka@example.test", invoiceEmailWillBeSent: false, receiptEmailWillBeSent: false };
    expect(renderSummary("record_invoice_payment", p, s)).toBe(
      "Record payment for invoice INV-7 · Amaka?\nPayment: NGN 5,000 · bank transfer\nOutstanding: NGN 15,000 → NGN 10,000\nCreate a receipt for this payment.\nCreate a new pickup order.\nStock · Shea butter: 10 → 7.",
    );
    expect(renderSummary("record_invoice_payment", { ...p, createReceipt: false }, { ...s, createsOrder: false })).toBe(
      "Record payment for invoice INV-7 · Amaka?\nPayment: NGN 5,000 · bank transfer\nOutstanding: NGN 15,000 → NGN 10,000\nDo not create a receipt.\nStock is unchanged.",
    );
  });

  it("shows invoice voiding, order cancellation, returned stock and customer email", () => {
    expect(renderSummary("void_invoice", { invoiceId: "invoice-1", cancelOrder: true }, { ...base, invoiceNumber: "INV-7", clientName: "Amaka", orderInfo: { id: "order-1", orderNumber: "ORD-8", clientEmail: "amaka@example.test", ...restock } })).toBe(
      "Void invoice INV-7 · Amaka?\nMark the invoice void.\nCancel order ORD-8.\nRestock · Shea butter: +3 (7 → 10).\nEmail order cancellation to: amaka@example.test.",
    );
  });

  it("shows order status, cancellation stock and known customer email", () => {
    expect(renderSummary("update_order", { orderId: "order-1", status: "CANCELLED" }, { ...base, orderNumber: "ORD-8", currentStatus: "NEW", clientEmail: "amaka@example.test", ...restock })).toBe(
      "Update order ORD-8?\nStatus: NEW → CANCELLED\nRestock · Shea butter: +3 (7 → 10).\nEmail order update to: amaka@example.test.",
    );
  });

  it("shows the exact stock adjustment", () => {
    expect(renderSummary("adjust_stock", { optionId: "option-1", mode: "add", quantity: 5, previousStock: 10, newStock: 15 }, { ...base, productName: "Shea butter", optionName: "Large" })).toBe(
      "Adjust stock for Shea butter · Large?\nAdd: 5\nStock: 10 → 15",
    );
  });

  it("shows booking times in Lagos and email/calendar effects", () => {
    const p: ResolvedPayloadByKind["update_booking"] = { bookingId: "booking-1", status: null, startTime: "2026-11-05T14:00:00.000Z", endTime: "2026-11-05T15:00:00.000Z", units: 1 };
    const s = { ...base, serviceName: "Consultation", currentStatus: "CONFIRMED", currentStartTime: "2026-11-04T12:00:00.000Z", currentEndTime: "2026-11-04T13:00:00.000Z", clientEmail: "amaka@example.test", calendarSyncNeeded: true, emailWillBeSent: true, calendarEventExists: true };
    expect(renderSummary("update_booking", p, s)).toBe(
      "Update booking for Consultation?\nCurrent time: 4 November 2026, 13:00 WAT → 4 November 2026, 14:00 WAT\nNew time: 5 November 2026, 15:00 WAT → 5 November 2026, 16:00 WAT\nUnits: 1\nEmail booking update to: amaka@example.test.\nSync the booking to Google Calendar.",
    );
    expect(renderSummary("update_booking", { ...p, status: "CANCELLED", startTime: null, endTime: null }, s)).toBe(
      "Update booking for Consultation?\nCurrent time: 4 November 2026, 13:00 WAT → 4 November 2026, 14:00 WAT\nStatus: CONFIRMED → CANCELLED\nUnits: 1\nEmail booking update to: amaka@example.test.\nRemove the booking from Google Calendar.",
    );
  });

  it("shows product base price, options and opening stock", () => {
    expect(renderSummary("create_product", { name: "Shea butter", description: "Organic", priceMinor: 500000, tracksStock: true, options: [{ name: "Large", priceMinor: 600000, stock: 10 }, { name: "Small", priceMinor: null, stock: 5 }] }, base)).toBe(
      "Create product Shea butter?\nBase price: NGN 5,000\nDescription: Organic\nTrack stock: Yes\nOption: Large · NGN 6,000 · stock 10\nOption: Small · NGN 5,000 (base price) · stock 5",
    );
  });

  it("shows every selected product update including clearing description", () => {
    expect(renderSummary("update_product", { productId: "product-1", name: "Body butter", description: null, priceMinor: 600000, isActive: false, tracksStock: true, options: [{ optionId: "option-1", name: "Large", priceMinor: null, stock: 8 }], fields: ["name", "description", "price", "isActive", "tracksStock", "options"] }, { ...base, productName: "Shea butter", currentPrice: 500000 })).toBe(
      "Update product Shea butter?\nName: Body butter\nDescription: Clear\nBase price: NGN 5,000 → NGN 6,000\nActive: No\nTrack stock: Yes\nReplace product options with:\nOption: Large · NGN 6,000 (base price) · stock 8",
    );
  });

  it("explicitly names options made inactive by option replacement", () => {
    const p: ResolvedPayloadByKind["update_product"] = { productId: "product-1", name: null, description: null, priceMinor: null, isActive: null, tracksStock: null, options: [{ optionId: "option-1", name: "Large", priceMinor: null, stock: 8 }], fields: ["options"] };
    expect(renderSummary("update_product", p, { ...base, productName: "Shea butter", currentPrice: 500000, tracksStock: true, existingOptions: [{ id: "option-1", name: "Large", isActive: true }, { id: "option-2", name: "Small", isActive: true }] })).toBe("Update product Shea butter?\nReplace product options with:\nOption: Large · NGN 5,000 (base price) · stock 8\nDeactivate option: Small.");
  });

  it("shows the inherited current base amount in an options-only update", () => {
    const p: ResolvedPayloadByKind["update_product"] = { productId: "product-1", name: null, description: null, priceMinor: null, isActive: null, tracksStock: null, options: [{ optionId: "option-1", name: "Large", priceMinor: null, stock: 8 }], fields: ["options"] };
    expect(renderSummary("update_product", p, { ...base, productName: "Shea butter", currentPrice: 500000, tracksStock: true, existingOptions: [{ id: "option-1", name: "Large", isActive: true }] })).toBe(
      "Update product Shea butter?\nReplace product options with:\nOption: Large · NGN 5,000 (base price) · stock 8",
    );
  });

  it("shows zero as the effective inherited price when the base price is updated with options", () => {
    const p: ResolvedPayloadByKind["update_product"] = { productId: "product-1", name: null, description: null, priceMinor: 0, isActive: null, tracksStock: null, options: [{ optionId: "option-1", name: "Large", priceMinor: null, stock: 8 }], fields: ["price", "options"] };
    expect(renderSummary("update_product", p, { ...base, productName: "Shea butter", currentPrice: 500000, tracksStock: true })).toBe(
      "Update product Shea butter?\nBase price: NGN 5,000 → NGN 0\nReplace product options with:\nOption: Large · NGN 0 (base price) · stock 8",
    );
  });

  it("names an inactive option made sellable again, including its new name", () => {
    const p: ResolvedPayloadByKind["update_product"] = { productId: "product-1", name: null, description: null, priceMinor: null, isActive: null, tracksStock: null, options: [{ optionId: "option-1", name: "Family size", priceMinor: null, stock: 8 }], fields: ["options"] };
    expect(renderSummary("update_product", p, { ...base, productName: "Shea butter", currentPrice: 500000, tracksStock: true, existingOptions: [{ id: "option-1", name: "Large", isActive: false }] })).toBe(
      "Update product Shea butter?\nReplace product options with:\nOption: Family size · NGN 5,000 (base price) · stock 8\nReactivate option: Family size.",
    );
  });

  it("does not invent stock changes for an untracked product cancellation", () => {
    expect(renderSummary("update_order", { orderId: "order-1", status: "CANCELLED" }, { ...base, orderNumber: "ORD-8", currentStatus: "NEW", restockLines: [{ productOptionId: "option-1", name: "Shea butter", quantity: 3 }], stockBefore: { "option-1": null }, stockAfter: { "option-1": null } })).toBe("Update order ORD-8?\nStatus: NEW → CANCELLED\nStock · Shea butter: not tracked.");
  });

  it("shows service price, duration, availability, booking mode and unit limits", () => {
    expect(renderSummary("create_service", { name: "Stay", description: null, priceMinor: 4500000, duration: 1440, bookingMode: "NIGHTLY", availableFrom: "00:00", availableTo: "23:59", checkInTime: "14:00", checkOutTime: "11:00", minUnits: 1, maxUnits: 7 }, base)).toBe(
      "Create service Stay?\nPrice: NGN 45,000\nDuration: 1440 minutes\nBooking mode: NIGHTLY\nAvailability: 00:00 → 23:59 WAT\nCheck-in: 14:00\nCheck-out: 11:00\nUnits: 1 → 7",
    );
  });

  it("shows every selected service field deterministically", () => {
    expect(renderSummary("update_service", { serviceId: "service-1", name: null, description: null, priceMinor: 600000, isActive: false, duration: 90, bookingMode: "SLOT", availableFrom: "09:00", availableTo: "17:00", checkInTime: null, checkOutTime: null, minUnits: 1, maxUnits: 1, fields: ["description", "price", "isActive", "duration", "bookingMode", "availableFrom", "availableTo", "checkInTime", "checkOutTime", "minUnits", "maxUnits"] }, { ...base, serviceName: "Consultation", currentPrice: 500000 })).toBe(
      "Update service Consultation?\nDescription: Clear\nDuration (minutes): 90\nBooking mode: SLOT\nAvailable from (WAT): 09:00\nAvailable to (WAT): 17:00\nCheck-in (WAT): Clear\nCheck-out (WAT): Clear\nMinimum units: 1\nMaximum units: 1\nPrice: NGN 5,000 → NGN 6,000\nActive: No",
    );
  });

  it("shows every new customer contact and notes", () => {
    expect(renderSummary("create_customer", { name: "Amaka", phone: "+2348012345678", email: "amaka@example.test", address: "Lagos", notes: "Prefers pickup" }, base)).toBe(
      "Create customer Amaka?\nPhone: +2348012345678\nEmail: amaka@example.test\nAddress: Lagos\nNotes: Prefers pickup",
    );
  });

  it("distinguishes customer clearing from omitted fields", () => {
    expect(renderSummary("update_customer", { customerId: "customer-1", name: "Amaka Obi", phone: null, email: null, address: "Abuja", notes: null, fields: ["address", "email", "name", "notes"] }, { ...base, customerName: "Amaka" })).toBe(
      "Update customer Amaka?\nName: Amaka Obi\nEmail: Clear\nAddress: Abuja\nNotes: Clear",
    );
  });

  it("rejects oversized previews rather than omitting any approved detail", () => {
    expect(() => renderSummary("create_invoice", { ...invoice, notes: "x".repeat(MAX_APPROVAL_SUMMARY_CHARS) }, base)).toThrow("Please split this request");
  });

  it("allows exactly 3,500 characters and rejects one more with a stable error code", () => {
    const prefix = "Create customer Amaka?\nNotes: ";
    const payload: ResolvedPayloadByKind["create_customer"] = { name: "Amaka", phone: null, email: null, address: null, notes: "x".repeat(3500 - prefix.length) };
    expect(MAX_APPROVAL_SUMMARY_CHARS).toBe(3500);
    expect(renderSummary("create_customer", payload, base)).toBe(prefix + payload.notes);
    expect(() => renderSummary("create_customer", { ...payload, notes: payload.notes + "x" }, base)).toThrow(expect.objectContaining({ code: "ASSISTANT_PREVIEW_TOO_LONG" }));
  });

  it("fails closed when tracked stock metadata or integer money is missing", () => {
    expect(() => renderSummary("create_receipt", receipt, base)).toThrow(expect.objectContaining({ code: "ASSISTANT_SUMMARY_METADATA_MISSING" }));
    expect(() => renderSummary("create_invoice", { ...invoice, totalMinor: 1.5 }, base)).toThrow(expect.objectContaining({ code: "ASSISTANT_SUMMARY_INVALID_AMOUNT" }));
  });
});
