import { IDS } from "./fixtures";

export type EvaluationCase = {
  id: string; turns: string[];
  expected: { kind: "read" | "draft" | "clarification" | "unsupported"; tool: string | null; facts: Record<string, string | number | boolean>; forbiddenWrites: boolean };
};
const define = (id: string, turns: string | string[], kind: EvaluationCase["expected"]["kind"], tool: string | null, facts: EvaluationCase["expected"]["facts"]): EvaluationCase => ({ id, turns: typeof turns === "string" ? [turns] : turns, expected: { kind, tool, facts, forbiddenWrites: true } });

// Expectations are independent constants. The dispatcher never imports cases.
export const EVALUATION_CASES: EvaluationCase[] = [
  define("01", "Invoice Tolu Adeyemi for two 18-inch frontal wigs, forty-five thousand each, due Friday", "draft", "draft_create_invoice", { customerId: IDS.tolu, optionId: IDS.wig18, quantity: 2, unitPriceMinor: 4500000, totalMinor: 9000000, dueDate: "2026-11-06" }),
  define("02", "Who hasn't paid me this week?", "read", "unpaid_invoices", { from: "2026-11-01T23:00:00.000Z", to: "2026-11-08T23:00:00.000Z", outstandingMinor: 6000000, count: 1 }),
  define("03", "Sold three bottles of shea butter to Amaka, paid cash, pickup", "draft", "draft_create_receipt", { quantity: 3, totalMinor: 1500000, method: "CASH", fulfilment: "PICKUP", stockAfter: 7 }),
  define("04", "How much did I make today?", "read", "business_summary", { period: "today", totalMinor: 3000000, count: 1 }),
  define("05", "Show this month's sales by item", "read", "business_summary", { period: "month", byItem: true, totalMinor: 4000000, "item.option-wig-18.totalMinor": 3000000, "item.option-shea.totalMinor": 1000000 }),
  define("06", "What bookings do I have tomorrow?", "read", "list_bookings", { from: "2026-11-04T23:00:00.000Z", to: "2026-11-05T23:00:00.000Z", count: 2, ids: `${IDS.pendingBooking},${IDS.confirmedBooking}` }),
  define("07", "What orders do I need to send out?", "read", "orders_to_send", { count: 2, statuses: "NEW,READY", ids: `${IDS.newOrder},${IDS.readyOrder}` }),
  define("08", "How much does Tolu Adeyemi owe me?", "read", "get_customer", { customerId: IDS.tolu, outstandingMinor: 6000000 }),
  define("09", "Find INV-1042", "read", "find_document", { documentId: IDS.invoice, number: "INV-1042", totalMinor: 9000000, paidMinor: 3000000, outstandingMinor: 6000000 }),
  define("10", "Give me the shea butter link", "read", "share_link", { id: IDS.shea, url: "https://sara.example/products/shea-butter" }),
  define("11", "Invoice Tolu for two wigs", "clarification", "draft_create_invoice", { choiceCount: 2, choices: `${IDS.tolu},${IDS.otherTolu}`, pendingWrites: 0 }),
  define("12", "Invoice Amaka for two frontal wigs", "clarification", "draft_create_invoice", { choiceCount: 2, choices: `${IDS.wig18},${IDS.wig20}`, pendingWrites: 0 }),
  define("13", "Invoice Amaka for two bottles of shea butter", "draft", "draft_create_invoice", { unitPriceMinor: 500000, totalMinor: 1000000, priceSource: "catalog" }),
  define("14", "Invoice Amaka for two bottles of shea butter, four thousand each", "draft", "draft_create_invoice", { unitPriceMinor: 400000, totalMinor: 800000, priceSource: "owner" }),
  define("15", ["Invoice Amaka for two bottles of shea butter", "Make it three instead"], "draft", "draft_create_invoice", { quantity: 3, totalMinor: 1500000, draftCount: 2, priorReplaced: true }),
  define("16", "Record ten thousand cash on INV-1042 and make a receipt", "draft", "draft_record_invoice_payment", { invoiceId: IDS.invoice, amountMinor: 1000000, createReceipt: true }),
  define("17", "Record seventy thousand cash on INV-1042", "clarification", "draft_record_invoice_payment", { error: "BALANCE_EXCEEDED", outstandingMinor: 6000000, pendingWrites: 0 }),
  define("18", "Void INV-1042 and cancel its order", "draft", "draft_void_invoice", { invoiceId: IDS.invoice, cancelOrder: true, orderId: IDS.newOrder, restockQuantity: 2 }),
  define("19", "Mark ORD-1001 ready", "draft", "draft_update_order", { orderId: IDS.newOrder, status: "READY" }),
  define("20", "Mark ORD-1002 delivered", "draft", "draft_update_order", { orderId: IDS.readyOrder, status: "COMPLETED" }),
  define("21", "Add five bottles to shea butter stock", "draft", "draft_adjust_stock", { optionId: IDS.sheaOption, mode: "add", quantity: 5, newStock: 15 }),
  define("22", "Set shea butter stock to two", "draft", "draft_adjust_stock", { optionId: IDS.sheaOption, mode: "set", quantity: 2, newStock: 2 }),
  define("23", "Add a product called Cocoa soap, two thousand naira, one option Standard, track stock, ten available", "draft", "draft_create_product", { name: "Cocoa soap", priceMinor: 200000, tracksStock: true, stock: 10, optionName: "Standard", photos: 0 }),
  define("24", "Pause shea butter", "draft", "draft_update_product", { productId: IDS.shea, isActive: false }),
  define("25", "Add Gele touch-up, a 30-minute slot service for five thousand naira, available 9am to 5pm, one session per booking", "draft", "draft_create_service", { name: "Gele touch-up", priceMinor: 500000, duration: 30, bookingMode: "SLOT", availableFrom: "09:00", availableTo: "17:00", minUnits: 1, maxUnits: 1 }),
  define("26", "Make Gele tying twenty thousand naira", "draft", "draft_update_service", { serviceId: IDS.gele, priceMinor: 2000000 }),
  define("27", "Confirm Amaka's pending booking tomorrow", "draft", "draft_update_booking", { bookingId: IDS.pendingBooking, status: "CONFIRMED" }),
  define("28", "Move Amaka's booking tomorrow to 11am", "draft", "draft_update_booking", { bookingId: IDS.pendingBooking, startTime: "2026-11-05T10:00:00.000Z", endTime: "2026-11-05T11:00:00.000Z" }),
  define("29", "Add customer Zainab, phone 08035550199", "draft", "draft_create_customer", { name: "Zainab", phone: "+2348035550199" }),
  define("30", "Change my bank account and WhatsApp every customer that I am closed", "unsupported", null, { mentionsMenu: true, pendingWrites: 0 }),
];
