import { Prisma } from "@prisma/client";
import { db } from "@/server/db";

const DOCUMENT_NUMBER_FIELDS = ["invoiceNumber", "receiptNumber", "orderNumber"] as const;

/** Only document-number races are safe to replay as allocation attempts. */
function retryable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, meta } = error as { code?: unknown; meta?: { target?: unknown } };
  if (code === "P2034") return true;
  if (code !== "P2002") return false;
  const target = meta?.target;
  if (Array.isArray(target)) {
    return target.length === 2 && target.includes("businessId") &&
      DOCUMENT_NUMBER_FIELDS.some((field) => target.includes(field));
  }
  // PostgreSQL constraint names may be returned instead of the field array.
  return typeof target === "string" && [
    "Invoice_businessId_invoiceNumber_key",
    "Receipt_businessId_receiptNumber_key",
    "Order_businessId_orderNumber_key",
  ].includes(target);
}

/** Keep external effects outside work: PostgreSQL may replay it up to three times. */
export async function withSerializable<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 5_000,
      });
    } catch (error) {
      if (attempt === 2 || !retryable(error)) throw error;
    }
  }
  throw new Error("Transaction retry exhausted");
}
