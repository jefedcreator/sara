import { z } from "zod";
import { baseQueryValidatorSchema } from "./index.validator";

const cuidValidator = z.string().cuid("id must be a valid cuid");

const dateValidator = (field: string) =>
    z.coerce.date(`${field} must be a valid date`);

export const paymentMethodValidatorSchema = z.enum(
    ["STRIPE", "PAYSTACK", "CASH", "BANK_TRANSFER"],
    "method must be one of: STRIPE, PAYSTACK, CASH, BANK_TRANSFER",
);

export const receiptValidatorSchema = z
    .object({
        businessId: cuidValidator,
        paymentId: cuidValidator,
        receiptNumber: z
            .string()
            .min(1, "receiptNumber cannot be empty")
            .max(255, "receiptNumber cannot exceed 255 characters"),
        clientName: z
            .string()
            .max(255, "clientName cannot exceed 255 characters")
            .nullable()
            .optional(),
        clientEmail: z
            .string()
            .email("clientEmail must be a valid email")
            .max(255, "clientEmail cannot exceed 255 characters")
            .nullable()
            .optional(),
        clientPhone: z
            .string()
            .max(50, "clientPhone cannot exceed 50 characters")
            .nullable()
            .optional(),
    })
    .strict();

export const updateReceiptValidatorSchema = receiptValidatorSchema
    .partial()
    .strict();

export const receiptQueryValidatorSchema = baseQueryValidatorSchema
    .partial()
    .extend({
        businessId: cuidValidator.optional(),
        clientName: z
            .string()
            .max(255, "clientName cannot exceed 255 characters")
            .optional(),
        clientEmail: z
            .string()
            .email("clientEmail must be a valid email")
            .max(255, "clientEmail cannot exceed 255 characters")
            .optional(),
        receiptNumber: z
            .string()
            .max(255, "receiptNumber cannot exceed 255 characters")
            .optional(),
        paymentId: cuidValidator.optional(),
        issuedFrom: dateValidator("issuedFrom").optional(),
        issuedTo: dateValidator("issuedTo").optional(),
        sortBy: z
            .enum(
                [
                    "receiptNumber",
                    "issuedAt",
                    "clientName",
                ],
                "sortBy must be one of: receiptNumber, issuedAt, clientName",
            )
            .default("issuedAt")
            .optional(),
    })
    .strict();

export type ReceiptValidatorSchema = z.infer<typeof receiptValidatorSchema>;
export type UpdateReceiptValidatorSchema = z.infer<typeof updateReceiptValidatorSchema>;
export type ReceiptQueryValidatorSchema = z.infer<typeof receiptQueryValidatorSchema>;
