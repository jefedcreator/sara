import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/server/db", () => ({ db: { $transaction: vi.fn() } }));
import { db } from "@/server/db";
import { withSerializable } from "./transaction";

const transaction = vi.mocked(db.$transaction);
beforeEach(() => vi.resetAllMocks());

describe("withSerializable", () => {
  it("passes the supplied transaction to work with bounded serializable settings", async () => {
    const tx = { marker: "tx" };
    transaction.mockImplementationOnce(async (work: any) => work(tx));
    const work = vi.fn().mockResolvedValue("committed");
    await expect(withSerializable(work)).resolves.toBe("committed");
    expect(work).toHaveBeenCalledWith(tx);
    expect(transaction).toHaveBeenCalledWith(work, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 5000,
    });
  });

  it.each([
    { code: "P2034" },
    { code: "P2002", meta: { target: ["businessId", "invoiceNumber"] } },
    { code: "P2002", meta: { target: ["businessId", "receiptNumber"] } },
    { code: "P2002", meta: { target: ["businessId", "orderNumber"] } },
    { code: "P2002", meta: { target: "Invoice_businessId_invoiceNumber_key" } },
  ])("retries a recognized serialization/number race: %j", async (error) => {
    transaction.mockRejectedValueOnce(error).mockResolvedValueOnce("ok");
    await expect(withSerializable(vi.fn())).resolves.toBe("ok");
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it("stops after three serialization attempts", async () => {
    const error = { code: "P2034" };
    transaction.mockRejectedValue(error);
    await expect(withSerializable(vi.fn())).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it.each([
    { code: "P2002", meta: { target: ["businessId", "phone"] } },
    { code: "P2002", meta: { target: ["invoiceId"] } },
    { code: "P2002", meta: { target: ["paymentId"] } },
    { code: "P2002", meta: { target: ["bookingId"] } },
    { code: "P2002", meta: { target: ["businessId", "invoiceNumber", "phone"] } },
    { code: "P2002", meta: { target: "unrecognized_invoiceNumber_constraint" } },
    new Error("database unavailable"),
  ])("does not retry unrelated failures: %j", async (error) => {
    transaction.mockRejectedValue(error);
    await expect(withSerializable(vi.fn())).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
