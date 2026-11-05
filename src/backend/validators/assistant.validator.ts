import { z } from "zod";

/** Identifiers are opaque database ids; only inbound request ids are UUIDs. */
export const assistantConversationIdSchema = z.string().trim().min(1).max(200);
export const assistantRequestIdSchema = z.string().uuid();

export const assistantMessageValidatorSchema = z.object({
  requestId: assistantRequestIdSchema,
  conversationId: assistantConversationIdSchema.optional(),
  text: z.string().trim().min(1).max(4_096),
}).strict();

/** Approval/edit requests never accept replacement payloads or tenant ids. */
export const assistantDraftValidatorSchema = z.object({
  conversationId: assistantConversationIdSchema,
}).strict();

export const assistantAudioFieldsSchema = z.object({
  requestId: assistantRequestIdSchema,
  conversationId: assistantConversationIdSchema.optional(),
}).strict();
