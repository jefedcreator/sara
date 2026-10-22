import { z } from "zod";

// Shapes the admin routes' JSDoc points at, so `yarn docs:generate` can
// describe them. Nothing validates with these: the real parameters, filters
// and bodies come from each resource's fields (see `GET /api/admin`).

export const adminResourceParams = z.object({
  resource: z.string().describe('A resource key, e.g. "business-hours"'),
});

export const adminRecordParams = z.object({
  resource: z.string().describe('A resource key, e.g. "business-hours"'),
  key: z.string().describe("The record's _key, URL-encoded"),
});

export const adminListQueryDoc = z.object({
  page: z.string().optional().describe("From 1, default 1"),
  size: z.string().optional().describe("1 to 100, default 20"),
  query: z.string().optional().describe("Up to 255 characters"),
  sortBy: z
    .string()
    .optional()
    .describe("One of the resource's sortable fields"),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

export const adminWriteBodyDoc = z
  .object({})
  .passthrough()
  .describe("A JSON object of the resource's writable fields");
