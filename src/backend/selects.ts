import type { Prisma } from "@prisma/client";

/**
 * The business fields safe to send back with an invoice or receipt. Never
 * `business: true`: that row also holds Google Calendar tokens, the Paystack
 * subaccount and bank details.
 */
export const publicBusinessSelect = {
  id: true,
  ownerId: true,
  name: true,
  slug: true,
  email: true,
  phone: true,
  address: true,
  city: true,
  state: true,
  country: true,
  logoUrl: true,
  currency: true,
} satisfies Prisma.BusinessSelect;
