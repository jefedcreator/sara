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

export type OrderQueryValidatorSchema = z.infer<
  typeof orderQueryValidatorSchema
>;
export type UpdateOrderValidatorSchema = z.infer<
  typeof updateOrderValidatorSchema
>;
