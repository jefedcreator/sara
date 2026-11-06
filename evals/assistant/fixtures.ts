import { Prisma } from "@prisma/client";
import { z } from "zod";

export const NOW = new Date("2026-11-04T11:00:00.000Z");
export const IDS = {
  business: "eval-business", conversation: "eval-conversation", owner: "eval-owner",
  tolu: "customer-tolu-adeyemi", otherTolu: "customer-tolu-bakare", amaka: "customer-amaka",
  wig: "product-frontal-wig", wig18: "option-wig-18", wig20: "option-wig-20",
  shea: "product-shea", sheaOption: "option-shea", gele: "service-gele",
  invoice: "invoice-1042", paidInvoice: "invoice-1043", newOrder: "order-1001", readyOrder: "order-1002",
  pendingBooking: "booking-amaka-pending", confirmedBooking: "booking-tolu-confirmed", completedBooking: "booking-completed",
} as const;
export const SCOPE = { businessId: IDS.business, channel: "WEB", principalId: IDS.owner } as const;
export const URLS = {
  shea: "https://sara.example/products/shea-butter",
  wig: "https://sara.example/products/frontal-wig",
  gele: "https://sara.example/services/gele-tying",
} as const;

// Validate every fixture before any calculation or fake database read. Money is
// stored in integer minor units here; Decimal conversion happens only at the
// real resolver boundary.
const money = z.number().int().nonnegative();
const customerSchema = z.object({ id: z.string(), name: z.string(), phone: z.string(), email: z.string().nullable() }).strict();
const optionSchema = z.object({ id: z.string(), name: z.string(), priceMinor: money.nullable(), stock: z.number().int().nonnegative() }).strict();
const productSchema = z.object({ id: z.string(), name: z.string(), priceMinor: money, options: z.array(optionSchema) }).strict();
const invoiceSchema = z.object({ id: z.string(), number: z.string(), customerId: z.string(), totalMinor: money, paidMinor: money, dueAt: z.iso.datetime(), status: z.enum(["SENT", "PAID"]) }).strict();
const bookingSchema = z.object({ id: z.string(), customerId: z.string(), status: z.enum(["PENDING", "CONFIRMED", "COMPLETED"]), startTime: z.iso.datetime(), endTime: z.iso.datetime() }).strict();
export const fixtureSchema = z.object({
  customers: z.array(customerSchema), products: z.array(productSchema),
  service: z.object({ id: z.string(), name: z.string(), priceMinor: money, duration: z.number().int().positive() }).strict(),
  invoices: z.array(invoiceSchema),
  payments: z.array(z.object({ id: z.string(), invoiceId: z.string(), amountMinor: money, at: z.iso.datetime(), itemId: z.string(), quantity: z.number().int().positive() }).strict()),
  bookings: z.array(bookingSchema),
  orders: z.array(z.object({ id: z.string(), number: z.string(), status: z.enum(["NEW", "READY", "COMPLETED"]), fulfilment: z.enum(["PICKUP", "DELIVERY"]) }).strict()),
}).strict();
export type Fixtures = z.infer<typeof fixtureSchema>;
export function createFixtures(): Fixtures {
  return fixtureSchema.parse({
    customers: [
      { id: IDS.tolu, name: "Tolu Adeyemi", phone: "+2348011111111", email: null },
      { id: IDS.otherTolu, name: "Tolu Bakare", phone: "+2348022222222", email: null },
      { id: IDS.amaka, name: "Amaka", phone: "+2348033333333", email: null },
    ],
    products: [
      { id: IDS.wig, name: "Frontal wig", priceMinor: 4500000, options: [
        { id: IDS.wig18, name: "18-inch", priceMinor: 4500000, stock: 11 },
        { id: IDS.wig20, name: "20-inch", priceMinor: 5000000, stock: 3 },
      ] },
      { id: IDS.shea, name: "Shea butter", priceMinor: 500000, options: [{ id: IDS.sheaOption, name: "", priceMinor: null, stock: 10 }] },
    ],
    service: { id: IDS.gele, name: "Gele tying", priceMinor: 1500000, duration: 60 },
    invoices: [
      { id: IDS.invoice, number: "INV-1042", customerId: IDS.tolu, totalMinor: 9000000, paidMinor: 3000000, dueAt: "2026-11-06T11:00:00.000Z", status: "SENT" },
      { id: IDS.paidInvoice, number: "INV-1043", customerId: IDS.amaka, totalMinor: 1000000, paidMinor: 1000000, dueAt: "2026-11-03T11:00:00.000Z", status: "PAID" },
    ],
    payments: [
      { id: "payment-1", invoiceId: IDS.invoice, amountMinor: 3000000, at: "2026-11-04T09:00:00.000Z", itemId: IDS.wig18, quantity: 2 },
      { id: "payment-2", invoiceId: IDS.paidInvoice, amountMinor: 1000000, at: "2026-11-03T09:00:00.000Z", itemId: IDS.sheaOption, quantity: 2 },
    ],
    bookings: [
      { id: IDS.pendingBooking, customerId: IDS.amaka, status: "PENDING", startTime: "2026-11-05T08:00:00.000Z", endTime: "2026-11-05T09:00:00.000Z" },
      { id: IDS.confirmedBooking, customerId: IDS.tolu, status: "CONFIRMED", startTime: "2026-11-05T12:00:00.000Z", endTime: "2026-11-05T13:00:00.000Z" },
      { id: IDS.completedBooking, customerId: IDS.amaka, status: "COMPLETED", startTime: "2026-11-03T08:00:00.000Z", endTime: "2026-11-03T09:00:00.000Z" },
    ],
    orders: [
      { id: IDS.newOrder, number: "ORD-1001", status: "NEW", fulfilment: "DELIVERY" },
      { id: IDS.readyOrder, number: "ORD-1002", status: "READY", fulfilment: "DELIVERY" },
      { id: "order-completed", number: "ORD-1003", status: "COMPLETED", fulfilment: "PICKUP" },
    ],
  });
}

type Row = Record<string, unknown>;
function object(value: unknown): value is Row { return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date); }
/** Small explicit subset of Prisma's read predicates. Unknown operators fail closed. */
export function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "OR" || key === "AND") {
      if (!Array.isArray(expected)) throw new Error("Unsupported fixture predicate");
      const results = expected.map((entry: unknown) => object(entry) && matches(row, entry));
      return key === "OR" ? results.some(Boolean) : results.every(Boolean);
    }
    const actual = row[key];
    if (!object(expected)) return actual instanceof Date && expected instanceof Date ? +actual === +expected : actual === expected;
    if (object(actual)) return matches(actual, expected);
    return Object.entries(expected).every(([op, value]) => {
      const a = actual instanceof Date ? actual.getTime() : actual;
      const b = value instanceof Date ? value.getTime() : value;
      switch (op) {
        case "mode": return value === "insensitive";
        case "in": return Array.isArray(value) && value.includes(actual);
        case "not": return actual !== value;
        case "equals": return typeof actual === "string" && typeof value === "string" ? actual.toLowerCase() === value.toLowerCase() : actual === value;
        case "contains": return typeof actual === "string" && typeof value === "string" && actual.toLowerCase().includes(value.toLowerCase());
        case "lt": return typeof a === "number" && typeof b === "number" && a < b;
        case "lte": return typeof a === "number" && typeof b === "number" && a <= b;
        case "gt": return typeof a === "number" && typeof b === "number" && a > b;
        case "gte": return typeof a === "number" && typeof b === "number" && a >= b;
        default: throw new Error(`Unsupported fixture predicate: ${op}`);
      }
    });
  });
}

/** The resolver gets read methods only. There is no mutation/approval implementation. */
export function fixtureDatabase(input: Fixtures, onForbiddenWrite: () => never): Prisma.TransactionClient {
  const f = fixtureSchema.parse(input);
  const decimal = (minor: number) => new Prisma.Decimal(minor).div(100);
  const common = { businessId: IDS.business, createdAt: NOW, updatedAt: NOW, description: null, isActive: true };
  const customers = f.customers.map((c) => ({ ...c, ...common, nameKey: c.name.toLowerCase(), address: null, notes: null }));
  const products = f.products.map((p) => ({ ...p, ...common, slug: p.id, price: decimal(p.priceMinor), tracksStock: true, photos: [] }));
  const options = products.flatMap((p) => p.options.map((o) => ({ ...o, isActive: true, productId: p.id, product: p, price: o.priceMinor === null ? null : decimal(o.priceMinor) })));
  const service = { ...f.service, ...common, slug: "gele-tying", image: null, price: decimal(f.service.priceMinor), bookingMode: "SLOT", availableFrom: "09:00", availableTo: "17:00", checkInTime: null, checkOutTime: null, minUnits: 1, maxUnits: 1 };
  const invoices = f.invoices.map((i) => ({ ...i, ...common, invoiceNumber: i.number, slug: i.number, publicId: i.id, total: decimal(i.totalMinor), amountPaid: decimal(i.paidMinor), dueAt: new Date(i.dueAt), clientName: customers.find((c) => c.id === i.customerId)?.name, clientPhone: null, clientEmail: null, currency: "NGN", status: i.status }));
  const lines = [{ productOptionId: IDS.sheaOption, name: "Shea butter", quantity: 2 }];
  const tables: Record<string, Row[]> = {
    business: [{ id: IDS.business, name: "Evaluation shop", currency: "NGN" }], customer: customers,
    product: products.map((p) => ({ ...p, options: options.filter((o) => o.productId === p.id) })), productOption: options,
    service: [service], invoice: invoices,
    order: f.orders.map((o) => ({ ...o, ...common, status: o.status, orderNumber: o.number, slug: o.number, publicId: o.id, currency: "NGN", total: decimal(1000000), deliveryAddress: "10 Lagos Road", invoiceId: o.id === IDS.newOrder ? IDS.invoice : null, clientName: "Amaka", clientEmail: null, clientPhone: null, lines })),
    booking: f.bookings.map((b) => ({ ...b, ...common, status: b.status, serviceId: service.id, service, slug: b.id, publicId: b.id, clientName: customers.find((c) => c.id === b.customerId)?.name, clientEmail: null, clientPhone: null, startTime: new Date(b.startTime), endTime: new Date(b.endTime), units: 1, googleEventId: null, holdExpiresAt: new Date("2026-11-06T00:00:00Z") })),
    orderLine: [],
  };
  const database = new Proxy({}, { get(_target, table: string) {
    const rows = tables[table];
    if (!rows) return onForbiddenWrite;
    return new Proxy({}, { get(_model, method: string) {
      if (!["findFirst", "findMany", "count", "groupBy"].includes(method)) return onForbiddenWrite;
      return async ({ where = {} }: { where?: Row } = {}) => {
        const found = rows.filter((row) => matches(row, where));
        if (method === "count") return found.length;
        if (method === "groupBy") { if (found.length) throw new Error("Add explicit groupBy fixture support"); return []; }
        return method === "findFirst" ? found[0] ?? null : found;
      };
    } });
  } });
  // One structural cast at the adapter boundary; all runtime methods fail closed.
  return database as Prisma.TransactionClient;
}
