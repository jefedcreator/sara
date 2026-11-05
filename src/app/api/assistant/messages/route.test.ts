import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticatedCookies, mockAuthenticatedSession } from "@/backend/test-utils/mock-request";

vi.mock("@/server/db", () => ({ db: {
  session: { findUnique: vi.fn(), delete: vi.fn() },
  assistantConversation: { findFirst: vi.fn(), upsert: vi.fn() },
} }));
vi.mock("@/backend/services/assistant", () => ({ assistantService: {
  message: vi.fn(), available: vi.fn(), conversation: vi.fn(),
} }));

import { assistantService } from "@/backend/services/assistant";
import { db } from "@/server/db";
import { POST } from "./route";

const mockedDb = db as any;
const ID = "6926bbd4-0522-4e9d-9ce4-d5adb0f75073";
const SCOPE = { businessId: "biz_1", principalId: "owner1", channel: "WEB" };
const REPLY = { conversationId: "web1", requestId: ID, transcript: null, reply: "You have three unpaid invoices.", draft: null, result: null };
const cookie = Object.entries(authenticatedCookies()).map(([key, value]) => `${key}=${value}`).join("; ");
function request(body: unknown = { requestId: ID, text: "List unpaid invoices" }, authenticated = true) {
  return new NextRequest("https://sara.test/api/assistant/messages", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://sara.test", ...(authenticated ? { cookie } : {}) }, body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticatedSession(mockedDb, { user: { id: "owner1" }, business: { id: "biz_1", ownerId: "owner1" } });
  mockedDb.assistantConversation.findFirst.mockResolvedValue({ id: "web1" });
  vi.mocked(assistantService.conversation).mockResolvedValue({ id: "web1" } as never);
  vi.mocked(assistantService.message).mockResolvedValue(REPLY);
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/assistant/messages", () => {
  it("returns the typed reply in the existing envelope and obtains the scope's conversation", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 200, message: "Success", data: REPLY });
    expect(assistantService.conversation).toHaveBeenCalledWith(SCOPE);
    expect(assistantService.message).toHaveBeenCalledWith({ scope: SCOPE, requestId: ID, input: { kind: "text", text: "List unpaid invoices" } });
  });
  it("checks an explicit conversation using every trusted scope dimension", async () => {
    const response = await POST(request({ requestId: ID, conversationId: "web1", text: "Hello" }));
    expect(response.status).toBe(200);
    expect(mockedDb.assistantConversation.findFirst).toHaveBeenCalledWith({ where: { id: "web1", ...SCOPE } });
    expect(assistantService.conversation).not.toHaveBeenCalled();
  });
  it("rejects a foreign user/channel conversation before model work", async () => {
    mockedDb.assistantConversation.findFirst.mockResolvedValue(null);
    const response = await POST(request({ requestId: ID, conversationId: "whatsapp1", text: "Hello" }));
    expect(response.status).toBe(404);
    expect(assistantService.message).not.toHaveBeenCalled();
  });
  it("does not read an unauthenticated upload", async () => {
    const form = new FormData();
    form.set("requestId", ID); form.set("audio", new File(["private audio"], "voice.ogg", { type: "audio/ogg" }));
    const input = new NextRequest("https://sara.test/api/assistant/messages", { method: "POST", body: form });
    const read = vi.spyOn(input.body!, "getReader");
    const parse = vi.spyOn(input, "formData");
    const response = await POST(input);
    expect(response.status).toBe(401);
    expect(read).not.toHaveBeenCalled(); expect(parse).not.toHaveBeenCalled();
    expect(assistantService.message).not.toHaveBeenCalled();
  });
  it.each([
    { requestId: ID, text: "hello", businessId: "biz_other" },
    { requestId: ID, text: "hello", principalId: "other" },
    { requestId: ID, text: "hello", audio: "bytes" },
  ])("rejects tenant selection and mixed JSON input", async (body) => {
    expect((await POST(request(body))).status).toBe(422);
    expect(assistantService.message).not.toHaveBeenCalled();
  });
  it("passes the same UUID unchanged so the service can replay its cached reply", async () => {
    const first = await (await POST(request())).json();
    const second = await (await POST(request())).json();
    expect(second.data).toEqual(first.data);
    expect(assistantService.message).toHaveBeenNthCalledWith(2, { scope: SCOPE, requestId: ID, input: { kind: "text", text: "List unpaid invoices" } });
  });
  it("returns busy as 409", async () => {
    vi.mocked(assistantService.message).mockRejectedValue(Object.assign(new Error("private"), { code: "ASSISTANT_BUSY" }));
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ status: 409, message: "Please wait for your current request to finish." });
  });
  it("maps an initial claim timeout to 503", async () => {
    vi.mocked(assistantService.message).mockRejectedValue(Object.assign(new Error("private"), { code: "ASSISTANT_TIMEOUT" }));
    expect((await POST(request())).status).toBe(503);
  });
  it("keeps ordinary assistant error replies in their typed 200 envelope", async () => {
    vi.mocked(assistantService.message).mockResolvedValue({ ...REPLY, reply: "Please try again, or type it." });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).data.reply).toBe("Please try again, or type it.");
  });
  it("passes audio lazily, then accepts a typed request after an audio error reply", async () => {
    const form = new FormData(); form.set("requestId", ID);
    form.set("audio", new File(["voice"], "voice.ogg", { type: "audio/ogg" }));
    vi.mocked(assistantService.message).mockImplementationOnce(async ({ input }) => {
      expect(input.kind).toBe("audio");
      expect(input).toEqual({ kind: "audio", load: expect.any(Function) });
      return { ...REPLY, reply: "Sorry, I couldn't make that out. Could you try again, or type it?" };
    });
    const response = await POST(new NextRequest("https://sara.test/api/assistant/messages", {
      method: "POST", headers: { cookie, origin: "https://sara.test" }, body: form,
    }));
    expect(response.status).toBe(200);
    expect((await POST(request())).status).toBe(200);
    expect(assistantService.message).toHaveBeenLastCalledWith(expect.objectContaining({ input: { kind: "text", text: "List unpaid invoices" } }));
  });
  it("never logs private inputs, transcripts or raw failures", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "debug"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    vi.mocked(assistantService.message).mockRejectedValue(new Error("secret transcript provider body"));
    const response = await POST(request({ requestId: ID, text: "private customer information" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ status: 500, message: "Internal server error" });
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });
});
