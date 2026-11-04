import { z } from "zod";

const nonblank = z.string().min(1).max(255).refine((value) => value.trim().length > 0, "A name cannot be blank");
const safeInteger = z.number().int().min(0).max(2_147_483_647);
const dueDateSchema = z.string().max(30).refine((value) => {
  if (/^(today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/i.test(value)) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Use an exact Lagos date, today, tomorrow or a weekday");

/** Patch keys remain strings in the public type; the boundary enforces the allowed set. */
function patchProblem(value: Record<string, unknown> & { fields: string[] }, allowed: string[], nullable: string[]): boolean {
  return new Set(value.fields).size === value.fields.length &&
    value.fields.every((key) => allowed.includes(key) && (nullable.includes(key) || value[key] !== null)) &&
    allowed.every((key) => value.fields.includes(key) || value[key] === null);
}

export const priceEvidenceSchema = z
  .object({
    quote: z.string().min(1).max(120),
    amountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export type PriceEvidence = z.infer<typeof priceEvidenceSchema>;

export const customerRef = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("existing"),
      id: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("new"),
      name: nonblank,
      phone: z.string().max(50).nullable(),
      email: z.string().email().max(255).nullable(),
    })
    .strict(),
]);
export type CustomerRef = z.infer<typeof customerRef>;

export const line = z
  .object({
    kind: z.enum(["service", "product", "custom"]),
    id: z.string().min(1).max(255).nullable(),
    name: nonblank.nullable(),
    quantity: z.number().int().min(1).max(999),
    priceOverride: priceEvidenceSchema.nullable(),
  })
  .strict()
  .refine((value) => value.kind === "custom"
    ? value.id === null && value.name !== null && value.priceOverride !== null
    : value.id !== null, "Catalog lines require an owned id; custom lines require a name and price with no id");
export type DraftLine = z.infer<typeof line>;

export const createInvoiceRequestSchema = z
  .object({
    kind: z.literal("create_invoice"),
    customer: customerRef,
    lines: z.array(line).min(1).max(30),
    dueDate: dueDateSchema.nullable(),
    notes: z.string().max(2000).nullable(),
  })
  .strict();
export type CreateInvoiceRequest = z.infer<typeof createInvoiceRequestSchema>;

export const createReceiptRequestSchema = z
  .object({
    kind: z.literal("create_receipt"),
    customer: customerRef.nullable(),
    lines: z.array(line).min(0).max(30),
    amount: priceEvidenceSchema.nullable(),
    method: z.enum(["CASH", "BANK_TRANSFER"]),
    fulfilment: z.enum(["PICKUP", "DELIVERY"]).nullable(),
    deliveryAddress: z.string().max(500).nullable(),
    notes: z.string().max(2000).nullable(),
  })
  .strict()
  .refine((value) => (value.lines.length > 0) !== (value.amount !== null), "A receipt needs either lines or an amount, never both");
export type CreateReceiptRequest = z.infer<typeof createReceiptRequestSchema>;

export const recordInvoicePaymentRequestSchema = z
  .object({
    kind: z.literal("record_invoice_payment"),
    invoiceId: z.string().min(1),
    amount: z
      .object({
        quote: z.string().min(1).max(120),
        amountMinor: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
      })
      .strict(),
    method: z.enum(["CASH", "BANK_TRANSFER"]),
    createReceipt: z.boolean(),
  })
  .strict();
export type RecordInvoicePaymentRequest = z.infer<
  typeof recordInvoicePaymentRequestSchema
>;

export const voidInvoiceRequestSchema = z
  .object({
    kind: z.literal("void_invoice"),
    invoiceId: z.string().min(1),
    cancelOrder: z.boolean(),
  })
  .strict();
export type VoidInvoiceRequest = z.infer<typeof voidInvoiceRequestSchema>;

export const updateOrderRequestSchema = z
  .object({
    kind: z.literal("update_order"),
    orderId: z.string().min(1),
    status: z.enum(["READY", "COMPLETED", "CANCELLED"]),
  })
  .strict();
export type UpdateOrderRequest = z.infer<typeof updateOrderRequestSchema>;

export const adjustStockRequestSchema = z
  .object({
    kind: z.literal("adjust_stock"),
    optionId: z.string().min(1),
    mode: z.enum(["add", "remove", "set"]),
    quantity: safeInteger,
  })
  .strict()
  .refine(
    (data) => (data.mode === "set" ? data.quantity >= 0 : data.quantity >= 1),
    { message: "quantity must be positive for add or remove" },
  );
export type AdjustStockRequest = z.infer<typeof adjustStockRequestSchema>;

export const updateBookingRequestSchema = z
  .object({
    kind: z.literal("update_booking"),
    bookingId: z.string().min(1),
    status: z.enum(["CONFIRMED", "CANCELLED", "COMPLETED"]).nullable(),
    startTime: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict()
  .refine(
    (data) => data.status !== null || data.startTime !== null,
    { message: "At least one change (status or startTime) is required" },
  );
export type UpdateBookingRequest = z.infer<typeof updateBookingRequestSchema>;

export const productOptionDraftSchema = z
  .object({
    name: z.string().min(0).max(255),
    price: priceEvidenceSchema.nullable(),
    stock: safeInteger.nullable(),
  })
  .strict();

export const createProductRequestSchema = z
  .object({
    kind: z.literal("create_product"),
    name: nonblank,
    description: z.string().max(1000).nullable(),
    price: priceEvidenceSchema,
    tracksStock: z.boolean(),
    options: z.array(productOptionDraftSchema).min(1).max(20),
  })
  .strict();
export type CreateProductRequest = z.infer<typeof createProductRequestSchema>;

export const updateProductOptionDraftSchema = z
  .object({
    optionId: z.string().nullable(),
    name: z.string().min(0).max(255),
    price: priceEvidenceSchema.nullable(),
    stock: safeInteger.nullable(),
  })
  .strict();

export const updateProductRequestSchema = z
  .object({
    kind: z.literal("update_product"),
    productId: z.string().min(1),
    name: nonblank.nullable(),
    description: z.string().max(1000).nullable(),
    price: priceEvidenceSchema.nullable(),
    isActive: z.boolean().nullable(),
    tracksStock: z.boolean().nullable(),
    options: z.array(updateProductOptionDraftSchema).min(1).max(20).nullable(),
    fields: z.array(z.string()).min(1),
  })
  .strict()
  .refine((value) => patchProblem(value, ["name", "description", "price", "isActive", "tracksStock", "options"], ["description"]), "Invalid patch fields or missing values");
export type UpdateProductRequest = z.infer<typeof updateProductRequestSchema>;

export const createServiceRequestSchema = z
  .object({
    kind: z.literal("create_service"),
    name: nonblank,
    description: z.string().max(1000).nullable(),
    price: priceEvidenceSchema,
    duration: z.number().int().min(1).max(2_147_483_647),
    bookingMode: z.enum(["SLOT", "NIGHTLY", "DAILY"]),
    availableFrom: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "availableFrom must be HH:mm"),
    availableTo: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "availableTo must be HH:mm"),
    checkInTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "checkInTime must be HH:mm")
      .nullable(),
    checkOutTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "checkOutTime must be HH:mm")
      .nullable(),
    minUnits: z.number().int().min(1).max(90),
    maxUnits: z.number().int().min(1).max(90),
  })
  .strict();
export type CreateServiceRequest = z.infer<typeof createServiceRequestSchema>;

export const updateServiceRequestSchema = z
  .object({
    kind: z.literal("update_service"),
    serviceId: z.string().min(1),
    name: nonblank.nullable(),
    description: z.string().max(1000).nullable(),
    price: priceEvidenceSchema.nullable(),
    isActive: z.boolean().nullable(),
    duration: z.number().int().min(1).max(2_147_483_647).nullable(),
    bookingMode: z.enum(["SLOT", "NIGHTLY", "DAILY"]).nullable(),
    availableFrom: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
    availableTo: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
    checkInTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
    checkOutTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
    minUnits: z.number().int().min(1).max(90).nullable(),
    maxUnits: z.number().int().min(1).max(90).nullable(),
    fields: z.array(z.string()).min(1),
  })
  .strict()
  .refine((value) => patchProblem(value, ["name", "description", "price", "isActive", "duration", "bookingMode", "availableFrom", "availableTo", "checkInTime", "checkOutTime", "minUnits", "maxUnits"], ["description", "checkInTime", "checkOutTime"]), "Invalid patch fields or missing values");
export type UpdateServiceRequest = z.infer<typeof updateServiceRequestSchema>;

export const createCustomerRequestSchema = z
  .object({
    kind: z.literal("create_customer"),
    name: nonblank,
    phone: z.string().max(50).nullable(),
    email: z.string().email().max(255).nullable(),
    address: z.string().max(1000).nullable(),
    notes: z.string().max(2000).nullable(),
  })
  .strict();
export type CreateCustomerRequest = z.infer<typeof createCustomerRequestSchema>;

export const updateCustomerRequestSchema = z
  .object({
    kind: z.literal("update_customer"),
    customerId: z.string().min(1),
    name: nonblank.nullable(),
    phone: z.string().max(50).nullable(),
    email: z.string().email().max(255).nullable(),
    address: z.string().max(1000).nullable(),
    notes: z.string().max(2000).nullable(),
    fields: z.array(z.string()).min(1),
  })
  .strict()
  .refine((value) => patchProblem(value, ["name", "phone", "email", "address", "notes"], ["phone", "email", "address", "notes"]), "Invalid patch fields or missing values");
export type UpdateCustomerRequest = z.infer<typeof updateCustomerRequestSchema>;

export const draftRequestSchema = z.discriminatedUnion("kind", [
  createInvoiceRequestSchema,
  createReceiptRequestSchema,
  recordInvoicePaymentRequestSchema,
  voidInvoiceRequestSchema,
  updateOrderRequestSchema,
  adjustStockRequestSchema,
  updateBookingRequestSchema,
  createProductRequestSchema,
  updateProductRequestSchema,
  createServiceRequestSchema,
  updateServiceRequestSchema,
  createCustomerRequestSchema,
  updateCustomerRequestSchema,
]);

export type DraftRequest = z.infer<typeof draftRequestSchema>;
export type DraftRequestKind = DraftRequest["kind"];
