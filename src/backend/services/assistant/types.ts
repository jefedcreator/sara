import type { Prisma } from "@prisma/client";
import type {
  ActionResult,
  AssistantChannel,
  AssistantReply,
  DraftDto,
} from "@/types/assistant";

/**
 * The trusted identity of one assistant conversation.
 *
 * Messaging principals are ChatIdentity ids; web principals are signed-in
 * User ids. Every lookup by scope includes all three values, so a draft or a
 * conversation can never cross a business, a channel or an owner.
 */
export type AssistantScope = {
  businessId: string;
  channel: AssistantChannel;
  principalId: string;
};

/** One completed tool call, kept concise for the next turn. */
export type StoredToolRecord = {
  name: string;
  arguments: Prisma.JsonValue;
  output: Prisma.JsonValue;
};

/** A completed turn as the model sees it on the next request. */
export type StoredTurn = {
  userText: string;
  transcript: string | null;
  reply: string;
  toolRecords: StoredToolRecord[];
  createdAt: Date;
};

/**
 * What `saveTurn` writes. It accepts either the plain reply text or the whole
 * AssistantReply, so the web duplicate-request path can replay the exact
 * result (and draft) that the owner already saw.
 */
export type SaveTurnInput = {
  userText?: string;
  transcript?: string | null;
  reply: string | AssistantReply;
  draft?: DraftDto | null;
  result?: ActionResult | null;
  toolRecords?: StoredToolRecord[];
  state?: "RUNNING" | "DONE" | "ERROR";
  memoryVersion: number;
  leaseToken: string;
};

/** Side effects run after the approved database transaction commits. */
export type Effect = {
  kind: "invoice_pdf" | "receipt_pdf" | "invoice_email" | "receipt_email" | "order_email" | "booking_sync";
  id: string;
  previousStartTime?: string;
  previousEndTime?: string;
};
