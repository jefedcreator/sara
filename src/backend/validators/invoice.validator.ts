import { z } from "zod";
import { baseQueryValidatorSchema } from "./index.validator";

const cuidValidator = z.string().cuid("id must be a valid cuid");

const optionalCuidValidator = cuidValidator.nullable().optional();

const decimalValidator = (field: string) =>
    z.coerce
        .number()
        .finite(`${field} must be a finite number`)
        .min(0, `${field} cannot be negative`);

const dateValidator = (field: string) =>
    z.coerce.date(`${field} must be a valid date`);

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
        businessId: cuidValidator,
        name: z
            .string()
            .min(1, "client.name cannot be empty")
            .max(255, "client.name cannot exceed 255 characters"),
        email: z
            .string()
            .email("client.email must be a valid email")
            .max(255, "client.email cannot exceed 255 characters")
            .nullable()
            .optional(),
        phone: z
            .string()
            .max(50, "client.phone cannot exceed 50 characters")
            .nullable()
            .optional(),
        bookingId: optionalCuidValidator,
        invoiceNumber: z
            .string()
            .min(1, "invoiceNumber cannot be empty")
            .max(255, "invoiceNumber cannot exceed 255 characters"),
        status: invoiceStatusValidatorSchema.default("DRAFT"),
        currency: z
            .string()
            .length(3, "currency must be a 3-letter ISO currency code")
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
    })
    .strict();

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
