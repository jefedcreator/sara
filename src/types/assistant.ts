/**
 * Wire types shared by the assistant's web client and server.
 *
 * These DTOs never carry a business id, principal id or any stored internal
 * payload. The server keeps those in the scoped backend types.
 */

export type AssistantChannel = "WHATSAPP" | "INSTAGRAM" | "WEB";

export type DraftStatus =
  | "PENDING"
  | "APPROVED"
  | "CANCELLED"
  | "EXPIRED"
  | "REPLACED"
  | "INVALID";

/** A proposed change awaiting the owner's approval. */
export type DraftDto = {
  id: string;
  summary: string;
  expiresAt: string;
  status: DraftStatus;
};

/** The parts of Sara that an approved action can change or invalidate. */
export type ResourceKind =
  | "invoices"
  | "receipts"
  | "orders"
  | "products"
  | "services"
  | "bookings"
  | "customers"
  | "dashboard";

/** The saved outcome of an approved action. */
export type ActionResult = {
  text: string;
  resourceId: string;
  link: string | null;
  affected: ResourceKind[];
};

/** The answer to one assistant request. */
export type AssistantReply = {
  conversationId: string;
  requestId: string;
  transcript: string | null;
  reply: string;
  draft: DraftDto | null;
  result: ActionResult | null;
};

/** The answer to approving, changing or cancelling a draft. */
export type ApprovalReply = {
  status: "approved" | "already_done" | "expired" | "changed" | "cancelled";
  reply: string;
  result: ActionResult | null;
  draft: DraftDto | null;
};
