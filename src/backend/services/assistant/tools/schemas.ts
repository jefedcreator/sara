import { z } from "zod";

const id = z.string().trim().min(1).max(255);
const query = z.string().trim().min(1).max(255);
const period = z.enum(["today", "week", "month"]);

export const findCustomersRequestSchema = z.object({
  name: z.literal("find_customers"), query,
}).strict();
export type FindCustomersRequest = z.infer<typeof findCustomersRequestSchema>;

export const getCustomerRequestSchema = z.object({
  name: z.literal("get_customer"), customerId: id,
}).strict();
export type GetCustomerRequest = z.infer<typeof getCustomerRequestSchema>;

export const listItemsRequestSchema = z.object({
  name: z.literal("list_items"), query: query.nullable(), includeInactive: z.boolean(),
}).strict();
export type ListItemsRequest = z.infer<typeof listItemsRequestSchema>;

export const unpaidInvoicesRequestSchema = z.object({
  name: z.literal("unpaid_invoices"), customerId: id.nullable(),
  period: z.enum(["today", "week", "month", "all"]),
}).strict();
export type UnpaidInvoicesRequest = z.infer<typeof unpaidInvoicesRequestSchema>;

/** ISO calendar dates are Lagos days; ISO timestamps must include an offset. */
const isoDate = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
export const listBookingsRequestSchema = z.object({
  name: z.literal("list_bookings"), from: isoDate, to: isoDate,
}).strict();
export type ListBookingsRequest = z.infer<typeof listBookingsRequestSchema>;

export const ordersToSendRequestSchema = z.object({
  name: z.literal("orders_to_send"),
}).strict();
export type OrdersToSendRequest = z.infer<typeof ordersToSendRequestSchema>;

export const businessSummaryRequestSchema = z.object({
  name: z.literal("business_summary"), period, byItem: z.boolean(),
}).strict();
export type BusinessSummaryRequest = z.infer<typeof businessSummaryRequestSchema>;

export const findDocumentRequestSchema = z.object({
  name: z.literal("find_document"), kind: z.enum(["invoice", "receipt", "order"]), number: query,
}).strict();
export type FindDocumentRequest = z.infer<typeof findDocumentRequestSchema>;

export const shareLinkRequestSchema = z.object({
  name: z.literal("share_link"), kind: z.enum(["service", "product"]), id,
}).strict();
export type ShareLinkRequest = z.infer<typeof shareLinkRequestSchema>;

export const readRequestSchema = z.discriminatedUnion("name", [
  findCustomersRequestSchema, getCustomerRequestSchema, listItemsRequestSchema,
  unpaidInvoicesRequestSchema, listBookingsRequestSchema, ordersToSendRequestSchema,
  businessSummaryRequestSchema, findDocumentRequestSchema, shareLinkRequestSchema,
]);
export type ReadRequest = z.infer<typeof readRequestSchema>;
