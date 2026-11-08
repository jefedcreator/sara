import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalReply } from "@/types";
import { authenticatedCookies, mockAuthenticatedSession } from "@/backend/test-utils/mock-request";

const { mockedDb, createInvoice } = vi.hoisted(() => ({ mockedDb: {
  session: { findUnique: vi.fn(), delete: vi.fn() },
  assistantConversation: { findFirst: vi.fn() }, assistantAction: { findFirst: vi.fn() },
}, createInvoice: vi.fn() }));
vi.mock("@/server/db", () => ({ db: mockedDb }));
vi.mock("@/backend/services/assistant/actions/approve", () => ({ approveAction: vi.fn() }));
vi.mock("@/backend/services/invoice", () => ({ invoiceService: { createInTransaction: createInvoice } }));

import { approveAction } from "@/backend/services/assistant/actions/approve";
import { POST as APPROVE } from "./route";

const SCOPE = { businessId: "biz_1", principalId: "owner1", channel: "WEB" };
const APPROVED = { status: "approved" as const, reply: "Invoice created", result: null, draft: null };
const cookie = Object.entries(authenticatedCookies()).map(([key, value]) => `${key}=${value}`).join("; ");
const context = { params: Promise.resolve({ id: "draft1" }) };
function request(body: unknown = { conversationId: "web1" }, authenticated = true) {
  return new NextRequest("https://sara.test/api/assistant/drafts/draft1/approve", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://sara.test", ...(authenticated ? { cookie } : {}) }, body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticatedSession(mockedDb, { user: { id: "owner1" }, business: { id: "biz_1", ownerId: "owner1" } });
  mockedDb.assistantConversation.findFirst.mockResolvedValue({ id: "web1" });
  mockedDb.assistantAction.findFirst.mockResolvedValue({ id: "draft1", conversationId: "web1" });
  vi.mocked(approveAction).mockResolvedValue(APPROVED);
});

describe("POST /api/assistant/drafts/:id/approve", () => {
  it("checks the conversation and draft under WEB scope before approving stored data", async () => {
    const response = await APPROVE(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 200, message: "Success", data: APPROVED });
    expect(mockedDb.assistantConversation.findFirst).toHaveBeenCalledWith({ where: { id: "web1", ...SCOPE } });
    expect(mockedDb.assistantAction.findFirst).toHaveBeenCalledWith({ where: {
      id: "draft1", businessId: "biz_1", conversation: SCOPE,
    } });
    expect(approveAction).toHaveBeenCalledWith(SCOPE, "draft1", expect.any(Date));
  });
  it("rejects an unlinked channel draft from the web", async () => {
    mockedDb.assistantAction.findFirst.mockResolvedValue(null);
    const response = await APPROVE(request(), { params: Promise.resolve({ id: "wa1" }) });
    expect(response.status).toBe(404);
    expect(createInvoice).not.toHaveBeenCalled();
    expect(approveAction).not.toHaveBeenCalled();
  });
  it("rejects a foreign user's conversation before action lookup", async () => {
    mockedDb.assistantConversation.findFirst.mockResolvedValue(null);
    expect((await APPROVE(request(), context)).status).toBe(404);
    expect(mockedDb.assistantAction.findFirst).not.toHaveBeenCalled();
    expect(approveAction).not.toHaveBeenCalled();
  });
  it("rejects a scoped action attached to a different supplied conversation", async () => {
    mockedDb.assistantAction.findFirst.mockResolvedValue({ id: "draft1", conversationId: "web2" });
    expect((await APPROVE(request(), context)).status).toBe(404);
    expect(approveAction).not.toHaveBeenCalled();
  });
  it.each(["businessId", "payload", "amount", "summary"])("rejects client replacement field %s", async (field) => {
    expect((await APPROVE(request({ conversationId: "web1", [field]: "replacement" }), context)).status).toBe(422);
    expect(approveAction).not.toHaveBeenCalled();
  });
  it("does not read an unauthenticated body", async () => {
    const input = request(undefined, false); const read = vi.spyOn(input.body!, "getReader");
    expect((await APPROVE(input, context)).status).toBe(401);
    expect(read).not.toHaveBeenCalled(); expect(approveAction).not.toHaveBeenCalled();
  });
  it("returns typed expiry and idempotent replay replies without route-level mutation", async () => {
    for (const status of ["expired", "already_done"] as const) {
      vi.mocked(approveAction).mockResolvedValue({ ...APPROVED, status });
      const response = await APPROVE(request(), context);
      expect(response.status).toBe(200);
      const body = await response.json() as { data: ApprovalReply };
      expect(body.data.status).toBe(status);
    }
    expect(createInvoice).not.toHaveBeenCalled();
  });
  it("maps lifecycle conflicts to 409", async () => {
    vi.mocked(approveAction).mockRejectedValue(Object.assign(new Error("private"), { code: "ASSISTANT_DRAFT_EDITING" }));
    expect((await APPROVE(request(), context)).status).toBe(409);
    expect(createInvoice).not.toHaveBeenCalled();
  });
});
