import { z } from "zod";

// The owner's invoice/receipt form. Everything stays a string (as the inputs
// give it); src/utils/documents.ts turns a valid form into the API payload.

/** "25,000" → 25000; "" → 0; anything else → NaN. */
export function parseMoney(value: string) {
  const cleaned = value.replace(/[,\s]/g, "");
  if (cleaned === "") return 0;
  return /^\d+(\.\d{1,2})?$/.test(cleaned) ? Number(cleaned) : Number.NaN;
}

const money = (message: string) =>
  z.string().trim().refine((v) => !Number.isNaN(parseMoney(v)), { message });

export const lineItemFormSchema = z.object({
  serviceId: z.string().min(1, "Pick a service"),
  quantity: z
    .string()
    .trim()
    .refine((v) => /^\d+$/.test(v) && Number(v) >= 1, { message: "At least 1" }),
  unitPrice: money("Enter a price, like 25000"),
});

export const documentFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Enter the customer's name")
      .max(255, "Keep the name under 255 characters"),
    email: z
      .string()
      .trim()
      .refine((v) => v === "" || z.string().email().safeParse(v).success, {
        message: "Enter a valid email, like ada@example.com",
      }),
    phone: z
      .string()
      .trim()
      .refine((v) => v === "" || /^\+?[\d\s-]{7,19}$/.test(v), {
        message: "Enter a valid phone number, like 0803 123 4567",
      }),
    mode: z.enum(["services", "amount"]),
    items: z.array(lineItemFormSchema),
    amount: money("Enter an amount in naira, like 25000"),
    description: z.string().trim().max(1000, "Keep it under 1,000 characters"),
    taxAmount: money("Enter tax in naira, like 1875"),
    discount: money("Enter a discount in naira, like 2000"),
    dueAt: z.string(),
    paymentMethod: z.enum(["CASH", "BANK_TRANSFER"]),
  })
  .strict()
  .superRefine((values, ctx) => {
    if (values.mode === "amount") {
      if (!(parseMoney(values.amount) > 0)) {
        ctx.addIssue({ code: "custom", path: ["amount"], message: "Enter an amount above 0" });
      }
      return;
    }
    if (values.items.length === 0) {
      ctx.addIssue({ code: "custom", path: ["items"], message: "Add at least one service" });
    }
    const seen = new Set<string>();
    values.items.forEach((item, index) => {
      if (item.serviceId && seen.has(item.serviceId)) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "serviceId"],
          message: "Already on this invoice; change the quantity instead",
        });
      }
      seen.add(item.serviceId);
    });
  });

export type DocumentFormSchema = z.infer<typeof documentFormSchema>;
export type LineItemFormSchema = z.infer<typeof lineItemFormSchema>;

/** Recording money against an invoice; at most what is still owed. */
export function paymentFormSchema(outstanding: number) {
  return z
    .object({
      amount: money("Enter an amount in naira, like 10000").refine(
        (v) => parseMoney(v) > 0,
        { message: "Enter an amount above 0" },
      ),
      paymentMethod: z.enum(["CASH", "BANK_TRANSFER"]),
      withReceipt: z.boolean(),
    })
    .strict()
    .refine((v) => parseMoney(v.amount) <= outstanding + 0.001, {
      message: "That's more than is owed",
      path: ["amount"],
    });
}

export type PaymentFormSchema = z.infer<ReturnType<typeof paymentFormSchema>>;
