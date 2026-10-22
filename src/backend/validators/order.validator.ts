import { z } from "zod";

import { baseQueryValidatorSchema } from "./index.validator";

/**
 * The owner's list filter. OPEN means NEW and READY together (the orders still
 * to send out). AWAITING_PAYMENT is deliberately absent: unpaid checkouts are
 * never part of order management.
 */
export const orderQueryValidatorSchema = z
  .object({
    status: z
      .enum(["OPEN", "NEW", "READY", "COMPLETED", "CANCELLED"], {
        message:
          "status must be one of: OPEN, NEW, READY, COMPLETED, CANCELLED",
      })
      .optional(),
    page: baseQueryValidatorSchema.shape.page,
    size: baseQueryValidatorSchema.shape.size,
  })
  .strict();

/**
 * PUT /api/orders/[slug] takes exactly one change: a status step, or a
 * fulfilment switch with the address a delivery needs.
 */
export const updateOrderValidatorSchema = z.union([
  z
    .object({
      status: z.enum(["READY", "COMPLETED", "CANCELLED"], {
        message: "status must be one of: READY, COMPLETED, CANCELLED",
      }),
    })
    .strict(),
  z
    .object({
      fulfilment: z.enum(["DELIVERY", "PICKUP"], {
        message: "fulfilment must be either DELIVERY or PICKUP",
      }),
      deliveryAddress: z
        .string()
        .trim()
        .max(1000, "deliveryAddress cannot exceed 1000 characters")
        .nullable()
        .optional(),
    })
    .strict(),
]);

/** POST /api/public/orders: a customer's checkout from a product page. */
export const publicOrderValidatorSchema = z
  .object({
    productSlug: z.string().min(1, "productSlug is required"),
    optionId: z.string().min(1, "optionId is required"),
    quantity: z.number().int().min(1, "quantity must be a whole number from 1"),
    fulfilment: z.enum(["DELIVERY", "PICKUP"]),
    deliveryAddress: z.string().max(500).nullable().optional(),
    clientName: z.string().min(1, "clientName is required").max(255),
    clientPhone: z.string().min(7, "clientPhone is required").max(20),
    clientEmail: z
      .string()
      .email("clientEmail must be a valid email")
      .nullable()
      .optional(),
  })
  .strict();

/**
 * The checkout sheet's fields as the customer types them. Kept apart from the
 * API schema above: this one speaks to the customer, and the address is only
 * required when they chose delivery.
 */
export const checkoutFormSchema = z
  .object({
    fulfilment: z.enum(["DELIVERY", "PICKUP"]),
    deliveryAddress: z.string().trim().max(500, "Keep the address under 500 characters"),
    clientName: z.string().trim().min(1, "Enter your name").max(255, "Keep your name under 255 characters"),
    clientPhone: z
      .string()
      .trim()
      .min(1, "Enter your phone number")
      .refine((value) => value.replace(/\D/g, "").length >= 7, "Enter a full phone number")
      .refine((value) => value.length <= 20, "Enter a shorter phone number"),
    clientEmail: z.union([z.literal(""), z.string().trim().email("Enter a valid email, or leave it empty")]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.fulfilment === "DELIVERY" && !value.deliveryAddress) {
      ctx.addIssue({ code: "custom", path: ["deliveryAddress"], message: "Enter a delivery address" });
    }
  });

export type PublicOrderValidatorSchema = z.infer<typeof publicOrderValidatorSchema>;
export type CheckoutFormSchema = z.input<typeof checkoutFormSchema>;

export type OrderQueryValidatorSchema = z.infer<
  typeof orderQueryValidatorSchema
>;
export type UpdateOrderValidatorSchema = z.infer<
  typeof updateOrderValidatorSchema
>;
