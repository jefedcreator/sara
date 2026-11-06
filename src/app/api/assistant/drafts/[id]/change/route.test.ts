import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authenticatedCookies, mockAuthenticatedSession } from "@/backend/test-utils/mock-request";

const { mockedDb, createInvoice } = vi.hoisted(() => ({ mockedDb: {
  session: { findUnique: vi.fn(), delete: vi.fn() },
  assistantConversation: { findFirst: vi.fn() }, assistantAction: { findFirst: vi.fn() },
}, createInvoice: vi.fn() }));
vi.mock("@/server/db", () => ({ db: mockedDb }));
vi.mock("@/backend/services/assistant/actions/drafts", () => ({ changeDraft: vi.fn() }));
vi.mock("@/backend/services/assistant/actions/approve", () => ({ approveAction: vi.fn() }));
vi.mock("@/backend/services/invoice", () => ({ invoiceService: { createInTransaction: createInvoice } }));

import { approveAction } from "@/backend/services/assistant/actions/approve";
import { changeDraft } from "@/backend/services/assistant/actions/drafts";
import { POST } from "./route";

const SCOPE = { businessId: "biz_1", principalId: "owner1", channel: "WEB" };
const DRAFT = { id: "draft1", summary: "Create an invoice for NGN 45,000", expiresAt: "2026-11-06T12:00:00.000Z", status: "PENDING" as const };
const cookie = Object.entries(authenticatedCookies()).map(([key, value]) => `${key}=${value}`).join("; ");
const context = { params: Promise.resolve({ id: "draft1" }) };
function request(body: unknown = { conversationId: "web1" }, authenticated = true) {
  return new NextRequest("https://sara.test/api/assistant/drafts/draft1/change", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://sara.test", ...(authenticated ? { cookie } : {}) }, body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticatedSession(mockedDb, { user: { id: "owner1" }, business: { id: "biz_1", ownerId: "owner1" } });
  mockedDb.assistantConversation.findFirst.mockResolvedValue({ id: "web1" });
  mockedDb.assistantAction.findFirst.mockResolvedValue({ id: "draft1", conversationId: "web1" });
  vi.mocked(changeDraft).mockResolvedValue(DRAFT);
});

describe("POST /api/assistant/drafts/:id/change", () => {
  it("asks what should change and returns the stored preview without executing its business mutation", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 200, message: "Success", data: { conversationId: "web1", reply: "What should change?", draft: DRAFT } });
    expect(changeDraft).toHaveBeenCalledWith(SCOPE, "draft1");
    expect(approveAction).not.toHaveBeenCalled();
    expect(createInvoice).not.toHaveBeenCalled();
  });
  it("checks the conversation and draft using WEB and the signed-in owner", async () => {
    await POST(request(), context);
    expect(mockedDb.assistantConversation.findFirst).toHaveBeenCalledWith({ where: { id: "web1", ...SCOPE } });
    expect(mockedDb.assistantAction.findFirst).toHaveBeenCalledWith({ where: { id: "draft1", businessId: "biz_1", conversation: SCOPE } });
  });
  it("does not read input before authenticating", async () => {
    const input = request(undefined, false); const read = vi.spyOn(input.body!, "getReader");
    expect((await POST(input, context)).status).toBe(401);
    expect(read).not.toHaveBeenCalled(); expect(changeDraft).not.toHaveBeenCalled();
  });
  it.each(["businessId", "text", "payload", "summary"])("rejects client-provided %s", async (field) => {
    expect((await POST(request({ conversationId: "web1", [field]: "replacement" }), context)).status).toBe(422);
    expect(changeDraft).not.toHaveBeenCalled();
  });
  it("rejects foreign action and mismatched action/conversation pairs", async () => {
    for (const action of [null, { id: "draft1", conversationId: "web2" }]) {
      mockedDb.assistantAction.findFirst.mockResolvedValue(action);
      expect((await POST(request(), context)).status).toBe(404);
    }
    expect(changeDraft).not.toHaveBeenCalled();
  });
  it("returns a lifecycle conflict for expired drafts", async () => {
    vi.mocked(changeDraft).mockRejectedValue(Object.assign(new Error("private"), { code: "ASSISTANT_DRAFT_EXPIRED" }));
    expect((await POST(request(), context)).status).toBe(409);
    expect(createInvoice).not.toHaveBeenCalled();
  });
});
