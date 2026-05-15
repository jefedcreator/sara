import { z } from "zod";
import { baseQueryValidatorSchema, dateValidator, decimalValidator } from "./index.validator";

const cuidValidator = z.string().cuid("id must be a valid cuid");

const optionalCuidValidator = cuidValidator.nullable().optional();

export const invoiceStatusValidatorSchema = z.enum(
    ["DRAFT", "SENT", "PARTIALLY_PAID", "PAID", "VOID", "OVERDUE"],
    "status must be one of: DRAFT, SENT, PARTIALLY_PAID, PAID, VOID, OVERDUE",
);

export const invoiceItemValidatorSchema = z
    .object({
        serviceId: optionalCuidValidator,
        description: z
            .string()
            .min(1, "description cannot be empty")
            .max(1000, "description cannot exceed 1000 characters"),
        quantity: z.coerce
            .number()
            .int("quantity must be an integer")
            .min(1, "quantity must be at least 1")
            .default(1),
        unitPrice: decimalValidator("unitPrice"),
        total: decimalValidator("total"),
    })
    .strict();

export const invoiceValidatorSchema = z
    .object({
        // businessId: cuidValidator,
        name: z
            .string()
            .min(1, "name cannot be empty")
            .max(255, "name cannot exceed 255 characters"),
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
        bookingId: optionalCuidValidator,
        // invoiceNumber: z
        //     .string()
        //     .max(255, "invoiceNumber cannot exceed 255 characters")
        //     .optional(),
        status: invoiceStatusValidatorSchema.default("DRAFT"),
        currency: z
            .string()
            .max(10, "currency code too long")
            .toUpperCase()
            .default("NGN"),
        subtotal: decimalValidator("subtotal"),
        taxAmount: decimalValidator("taxAmount").default(0),
        discount: decimalValidator("discount").default(0),
        total: decimalValidator("total"),
        amountPaid: decimalValidator("amountPaid").default(0),
        dueAt: dateValidator("dueAt").nullable().optional(),
        sentAt: dateValidator("sentAt").nullable().optional(),
        paidAt: dateValidator("paidAt").nullable().optional(),
        notes: z
            .string()
            .max(2000, "notes cannot exceed 2000 characters")
            .nullable()
            .optional(),
        items: z.array(invoiceItemValidatorSchema).optional(),
    });

export const updateInvoiceValidatorSchema = invoiceValidatorSchema
    .partial()
    .strict();

export const invoiceQueryValidatorSchema = baseQueryValidatorSchema
    .partial()
    .extend({
        businessId: cuidValidator.optional(),
        clientEmail: z
            .string()
            .email("clientEmail must be a valid email")
            .max(255, "clientEmail cannot exceed 255 characters")
            .optional(),
        clientName: z
            .string()
            .max(255, "clientName cannot exceed 255 characters")
            .optional(),
        bookingId: cuidValidator.optional(),
        status: invoiceStatusValidatorSchema.optional(),
        invoiceNumber: z
            .string()
            .max(255, "invoiceNumber cannot exceed 255 characters")
            .optional(),
        dueFrom: dateValidator("dueFrom").optional(),
        dueTo: dateValidator("dueTo").optional(),
        createdFrom: dateValidator("createdFrom").optional(),
        createdTo: dateValidator("createdTo").optional(),
        sortBy: z
            .enum(
                [
                    "invoiceNumber",
                    "status",
                    "dueAt",
                    "sentAt",
                    "paidAt",
                    "total",
                    "createdAt",
                    "updatedAt",
                ],
                "sortBy must be one of: invoiceNumber, status, dueAt, sentAt, paidAt, total, createdAt, updatedAt",
            )
            .default("createdAt")
            .optional(),
    })
    .strict();

export type InvoiceStatusValidatorSchema = z.infer<
    typeof invoiceStatusValidatorSchema
>;
export type InvoiceItemValidatorSchema = z.infer<
    typeof invoiceItemValidatorSchema
>;
export type InvoiceValidatorSchema = z.infer<typeof invoiceValidatorSchema>;
export type UpdateInvoiceValidatorSchema = z.infer<
    typeof updateInvoiceValidatorSchema
>;
export type InvoiceQueryValidatorSchema = z.infer<
    typeof invoiceQueryValidatorSchema
>;
