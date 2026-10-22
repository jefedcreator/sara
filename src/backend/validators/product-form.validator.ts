import { z } from "zod";

// Kept apart from product.validator.ts (the API's schemas): this one parses
// the owner's form strings into the numbers the API takes. Photos are UI
// state and travel separately as files.

const MAX_OPTIONS = 20;
const MAX_NAME_LENGTH = 255;

const money = z
  .string()
  .trim()
  .min(1, "Enter a price")
  .transform((value) => value.replace(/[,\s]/g, ""))
  .refine((value) => /^\d+(\.\d{1,2})?$/.test(value), {
    message: "Enter an amount in naira, like 45000",
  })
  .transform(Number);

const optionalMoney = z
  .string()
  .trim()
  .transform((value) => value.replace(/[,\s]/g, ""))
  .refine((value) => value === "" || /^\d+(\.\d{1,2})?$/.test(value), {
    message: "Enter an amount in naira, like 45000",
  })
  .transform((value) => (value === "" ? null : Number(value)));

const optionSchema = z.object({
  id: z.string().min(1).optional(),
  name: z
    .string()
    .trim()
    .max(MAX_NAME_LENGTH, `Keep the option name under ${MAX_NAME_LENGTH} characters`),
  price: optionalMoney,
  // Checked below only when the product tracks stock. Off means made to
  // order, so every option's stock becomes 0.
  stock: z.string().trim(),
});

export const productFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Enter a name, like “Frontal wig”")
      .max(MAX_NAME_LENGTH, "Keep the name under 255 characters"),
    description: z
      .string()
      .trim()
      .max(1000, "Keep the description under 1,000 characters"),
    price: money,
    tracksStock: z.boolean(),
    options: z
      .array(optionSchema)
      .min(1, "Add at least one option")
      .max(MAX_OPTIONS, `A product can have up to ${MAX_OPTIONS} options`),
  })
  .strict()
  .superRefine((value, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });

    const names = new Map<string, number>();

    value.options.forEach((option, index) => {
      if (value.options.length > 1 && !option.name) {
        issue(
          ["options", index, "name"],
          "Name each option, like “20 inch” or “Red”",
        );
      }

      if (option.name) {
        const key = option.name.toLowerCase();
        if (names.has(key)) {
          issue(["options", index, "name"], "Each option needs a different name");
        } else {
          names.set(key, index);
        }
      }

      if (value.tracksStock && !/^\d+$/.test(option.stock)) {
        issue(["options", index, "stock"], "Enter how many you have");
      }
    });
  })
  .transform((value) => ({
    name: value.name,
    description: value.description,
    price: value.price,
    tracksStock: value.tracksStock,
    options: value.options.map((option) => ({
      ...(option.id ? { id: option.id } : {}),
      name: option.name,
      price: option.price,
      stock: value.tracksStock ? Number(option.stock) : 0,
    })),
  }));

export type ProductFormInput = z.input<typeof productFormSchema>;
export type ProductFormOutput = z.output<typeof productFormSchema>;
