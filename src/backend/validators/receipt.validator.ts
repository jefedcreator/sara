import { z } from "zod";
import { baseQueryValidatorSchema, decimalValidator } from "./index.validator";

const cuidValidator = z.string().cuid("id must be a valid cuid");

const dateValidator = (field: string) =>
  z.coerce.date(`${field} must be a valid date`);

export const paymentMethodValidatorSchema = z.enum(
  ["STRIPE", "PAYSTACK", "CASH", "BANK_TRANSFER"],
  "method must be one of: STRIPE, PAYSTACK, CASH, BANK_TRANSFER",
);

export const receiptItemValidatorSchema = z
  .object({
    serviceId: cuidValidator,
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
  .strict();

export const receiptValidatorSchema = z
  .object({
    paymentId: cuidValidator.optional(),
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
    services: z.array(receiptItemValidatorSchema).optional(),
  })
  .strict();

export const updateReceiptValidatorSchema = receiptValidatorSchema
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
