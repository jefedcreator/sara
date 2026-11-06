import { draftRequestSchema, type DraftRequest } from "../../src/backend/services/assistant/actions/schemas";
import { readRequestSchema, type ReadRequest } from "../../src/backend/services/assistant/tools/schemas";
import { IDS } from "./fixtures";

export type ScriptedCall = { name: string; args: DraftRequest | ReadRequest };
const call = (args: DraftRequest | ReadRequest): ScriptedCall => {
  const read = readRequestSchema.safeParse(args);
  return { name: read.success ? read.data.name : `draft_${draftRequestSchema.parse(args).kind}`, args };
};
const invoice = (customerId = IDS.amaka as string, optionId = IDS.sheaOption as string, quantity = 2, priceOverride: { quote: string; amountMinor: number } | null = null): DraftRequest => ({ kind: "create_invoice", customer: { kind: "existing", id: customerId }, lines: [{ kind: "product", id: optionId, name: null, quantity, priceOverride }], dueDate: null, notes: null });
const servicePatch = { kind: "update_service", serviceId: IDS.gele, name: null, description: null, price: { quote: "twenty thousand naira", amountMinor: 2000000 }, isActive: null, duration: null, bookingMode: null, availableFrom: null, availableTo: null, checkInTime: null, checkOutTime: null, minUnits: null, maxUnits: null, fields: ["price"] } satisfies DraftRequest;

// Protocol recordings, never expected facts. Each inner list is one owner turn.
// An empty list makes a Responses completion with no tools.
export const CANNED_CALLS: Record<string, ScriptedCall[][]> = {
  "01": [[call({ ...invoice(IDS.tolu, IDS.wig18, 2, { quote: "forty-five thousand", amountMinor: 4500000 }), dueDate: "friday" } as DraftRequest)]],
  "02": [[call({ name: "unpaid_invoices", customerId: null, period: "week" })]],
  "03": [[call({ kind: "create_receipt", customer: { kind: "existing", id: IDS.amaka }, lines: [{ kind: "product", id: IDS.sheaOption, name: null, quantity: 3, priceOverride: null }], amount: null, method: "CASH", fulfilment: "PICKUP", deliveryAddress: null, notes: null })]],
  "04": [[call({ name: "business_summary", period: "today", byItem: false })]],
  "05": [[call({ name: "business_summary", period: "month", byItem: true })]],
  "06": [[call({ name: "list_bookings", from: "2026-11-05", to: "2026-11-06" })]],
  "07": [[call({ name: "orders_to_send" })]],
  "08": [[call({ name: "get_customer", customerId: IDS.tolu })]],
  "09": [[call({ name: "find_document", kind: "invoice", number: "INV-1042" })]],
  "10": [[call({ name: "share_link", kind: "product", id: IDS.shea })]],
  "11": [[call(invoice(IDS.tolu, IDS.wig18))]],
  "12": [[call(invoice(IDS.amaka, IDS.wig18))]],
  "13": [[call(invoice())]],
  "14": [[call(invoice(IDS.amaka, IDS.sheaOption, 2, { quote: "four thousand", amountMinor: 400000 }))]],
  "15": [[call(invoice())], [call(invoice(IDS.amaka, IDS.sheaOption, 3))]],
  "16": [[call({ kind: "record_invoice_payment", invoiceId: IDS.invoice, amount: { quote: "ten thousand", amountMinor: 1000000 }, method: "CASH", createReceipt: true })]],
  "17": [[call({ kind: "record_invoice_payment", invoiceId: IDS.invoice, amount: { quote: "seventy thousand", amountMinor: 7000000 }, method: "CASH", createReceipt: false })]],
  "18": [[call({ kind: "void_invoice", invoiceId: IDS.invoice, cancelOrder: true })]],
  "19": [[call({ kind: "update_order", orderId: IDS.newOrder, status: "READY" })]],
  "20": [[call({ kind: "update_order", orderId: IDS.readyOrder, status: "COMPLETED" })]],
  "21": [[call({ kind: "adjust_stock", optionId: IDS.sheaOption, mode: "add", quantity: 5 })]],
  "22": [[call({ kind: "adjust_stock", optionId: IDS.sheaOption, mode: "set", quantity: 2 })]],
  "23": [[call({ kind: "create_product", name: "Cocoa soap", description: null, price: { quote: "two thousand naira", amountMinor: 200000 }, tracksStock: true, options: [{ name: "Standard", price: null, stock: 10 }] })]],
  "24": [[call({ kind: "update_product", productId: IDS.shea, name: null, description: null, price: null, isActive: false, tracksStock: null, options: null, fields: ["isActive"] })]],
  "25": [[call({ kind: "create_service", name: "Gele touch-up", description: null, price: { quote: "five thousand naira", amountMinor: 500000 }, duration: 30, bookingMode: "SLOT", availableFrom: "09:00", availableTo: "17:00", checkInTime: null, checkOutTime: null, minUnits: 1, maxUnits: 1 })]],
  "26": [[call(servicePatch)]],
  "27": [[call({ kind: "update_booking", bookingId: IDS.pendingBooking, status: "CONFIRMED", startTime: null })]],
  "28": [[call({ kind: "update_booking", bookingId: IDS.pendingBooking, status: null, startTime: "2026-11-05T10:00:00Z" })]],
  "29": [[call({ kind: "create_customer", name: "Zainab", phone: "08035550199", email: null, address: null, notes: null })]],
  "30": [[]],
};
