import { z } from "zod";
import {
  baseQueryValidatorSchema,
  decimalValidator,
  withoutDefaults,
} from "./index.validator";

const cuidValidator = z.string().cuid("id must be a valid cuid");

const dateValidator = (field: string) =>
  z.coerce.date(`${field} must be a valid date`);

export const paymentMethodValidatorSchema = z.enum(
  ["STRIPE", "PAYSTACK", "CASH", "BANK_TRANSFER"],
  "method must be one of: STRIPE, PAYSTACK, CASH, BANK_TRANSFER",
);

export const receiptItemValidatorSchema = z
  .object({
    serviceId: cuidValidator.nullable().optional(),
    productOptionId: cuidValidator.nullable().optional(),
    name: z
      .string()
      .trim()
      .min(1, "name cannot be empty")
      .max(255, "name cannot exceed 255 characters")
      .optional(),
    description: z
      .string()
      .min(1, "description cannot be empty")
      .max(1000, "description cannot exceed 1000 characters")
      .nullable()
      .optional(),
    quantity: z.coerce
      .number()
      .int("quantity must be an integer")
      .min(1, "quantity must be at least 1")
      .default(1),
    unitPrice: decimalValidator("unitPrice"),
    total: decimalValidator("total"),
  })
  .strict()
  .refine((line) => Boolean(line.serviceId || line.productOptionId || line.name), {
    message: "A line needs a service, a product option or a name",
    path: ["serviceId"],
  });

/** How the products on a walk-in receipt reach the customer. */
export const receiptSaleValidatorSchema = z
  .object({
    fulfilment: z.enum(
      ["DELIVERY", "PICKUP"],
      "fulfilment must be one of: DELIVERY, PICKUP",
    ),
    deliveryAddress: z
      .string()
      .trim()
      .max(500, "deliveryAddress cannot exceed 500 characters")
      .nullable()
      .optional(),
  })
  .strict();

export const receiptValidatorSchema = z
  .object({
    paymentId: cuidValidator.optional(),
    customerId: cuidValidator.nullable().optional(),
    // receiptNumber: z
    //     .string()
    //     .min(1, "receiptNumber cannot be empty")
    //     .max(255, "receiptNumber cannot exceed 255 characters"),
    name: z
      .string()
      .max(255, "name cannot exceed 255 characters")
      .nullable()
      .optional(),
    email: z
      .string()
      .email("email must be a valid email")
      .max(255, "email cannot exceed 255 characters")
      .nullable()
      .optional(),
    phone: z
      .string()
      .max(50, "phone cannot exceed 50 characters")
      .nullable()
      .optional(),
    currency: z.string().default("USD"),
    subtotal: decimalValidator("subtotal"),
    taxAmount: decimalValidator("taxAmount").default(0),
    discount: decimalValidator("discount").default(0),
    total: decimalValidator("total"),
    amountPaid: decimalValidator("amountPaid").default(0),
    paymentMethod: paymentMethodValidatorSchema.optional().nullable(),
    notes: z
      .string()
      .max(2000, "notes cannot exceed 2000 characters")
      .nullable()
      .optional(),
    lines: z.array(receiptItemValidatorSchema).optional(),
    sale: receiptSaleValidatorSchema.optional(),
  })
  .strict();

// A sale is decided when the receipt is made, never edited afterwards.
export const updateReceiptValidatorSchema = z
  .object(withoutDefaults(receiptValidatorSchema.omit({ sale: true }).shape))
  .partial()
  .strict();

export const receiptQueryValidatorSchema = baseQueryValidatorSchema
  .partial()
  .extend({
    name: z.string().max(255, "name cannot exceed 255 characters").optional(),
    email: z
      .string()
      .email("email must be a valid email")
      .max(255, "email cannot exceed 255 characters")
      .optional(),
    paymentId: cuidValidator.optional(),
    createdFrom: dateValidator("createdFrom").optional(),
    createdTo: dateValidator("createdTo").optional(),
    sortBy: z
      .enum(
        ["receiptNumber", "createdAt", "name"],
        "sortBy must be one of: receiptNumber, createdAt, name",
      )
      .default("createdAt")
      .optional(),
  })
  .strict();

export type ReceiptValidatorSchema = z.infer<typeof receiptValidatorSchema>;
export type UpdateReceiptValidatorSchema = z.infer<
  typeof updateReceiptValidatorSchema
>;
export type ReceiptQueryValidatorSchema = z.infer<
  typeof receiptQueryValidatorSchema
>;
