import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticatedCookies, mockAuthenticatedSession, MOCK_SESSION_TOKEN } from "@/backend/test-utils/mock-request";

vi.mock("@/server/db", () => ({ db: { session: { findUnique: vi.fn(), delete: vi.fn() } } }));
vi.mock("./store", () => ({ assertConversation: vi.fn(), getAction: vi.fn() }));

import { db } from "@/server/db";
import { MAX_AUDIO_BYTES } from "./config";
import {
  MAX_ASSISTANT_JSON_BYTES, MAX_ASSISTANT_MULTIPART_BYTES,
  readAssistantDraftInput, readAssistantInput, requireAssistantAction,
  requireAssistantOwner, withAssistantOwner,
} from "./http";
import { assertConversation, getAction } from "./store";

const mockedDb = db as unknown as { session: { findUnique: ReturnType<typeof vi.fn> } };
const SCOPE = { businessId: "biz_1", principalId: "owner1", channel: "WEB" as const };
const ID = "6926bbd4-0522-4e9d-9ce4-d5adb0f75073";
const cookie = Object.entries(authenticatedCookies()).map(([key, value]) => `${key}=${value}`).join("; ");
const signal = () => new AbortController().signal;
function json(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("https://sara.test/api/assistant/messages", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });
}
function multipart(modify?: (form: FormData) => void) {
  const form = new FormData();
  form.set("requestId", ID);
  form.set("audio", new File(["voice"], "voice.webm", { type: "audio/webm" }));
  modify?.(form);
  return new NextRequest("https://sara.test/api/assistant/messages", { method: "POST", body: form });
}
function streamed(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  const cancel = vi.fn();
  let index = 0;
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (index < chunks.length) controller.enqueue(chunks[index++]);
    else controller.close();
  });
  const body = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
  const init = {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body, duplex: "half" as const,
  };
  const request = new NextRequest("https://sara.test/api/assistant/messages", init);
  return { request, cancel, pull };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticatedSession(mockedDb, {
    user: { id: SCOPE.principalId }, business: { id: SCOPE.businessId, ownerId: SCOPE.principalId },
  });
});
afterEach(() => vi.restoreAllMocks());

describe("assistant owner authentication", () => {
  it("derives WEB scope from the live owner session", async () => {
    await expect(requireAssistantOwner(json({}, { cookie, origin: "https://sara.test" }))).resolves.toEqual(SCOPE);
  });
  it("rejects a missing session before acquiring or parsing the body", async () => {
    const { request } = streamed([new Uint8Array(MAX_ASSISTANT_MULTIPART_BYTES + 1)]);
    const read = vi.spyOn(request.body!, "getReader");
    const parse = vi.spyOn(request, "formData");
    const handler = vi.fn(async () => { await readAssistantInput(request, request.signal); return new Response(); });
    const response = await withAssistantOwner(request, handler);
    expect(response.status).toBe(401);
    expect(read).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
  it.each([null, { id: "biz_1", ownerId: "other-owner" }])("rejects no business or a foreign owner", async (business) => {
    mockAuthenticatedSession(mockedDb, { user: { id: "owner1" }, business });
    await expect(requireAssistantOwner(json({}, { cookie, origin: "https://sara.test" }))).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["https://attacker.test", "null", "https://sara.test.attacker.test", ""])('rejects cookie writes with origin "%s"', async (origin) => {
    await expect(requireAssistantOwner(json({}, { cookie, origin }))).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects cookie writes without an origin even when a bearer is also supplied", async () => {
    await expect(requireAssistantOwner(json({}, { cookie, authorization: `Bearer ${MOCK_SESSION_TOKEN}` }))).rejects.toMatchObject({ statusCode: 403 });
  });
  it("retains bearer-only sessions without requiring a browser origin", async () => {
    await expect(requireAssistantOwner(json({}, { authorization: `Bearer ${MOCK_SESSION_TOKEN}` }))).resolves.toEqual(SCOPE);
  });
  it("checks the supplied conversation and the stored action relationship", async () => {
    vi.mocked(getAction).mockResolvedValue({ conversationId: "different" } as never);
    await expect(requireAssistantAction(SCOPE, "web1", "draft1")).rejects.toMatchObject({ statusCode: 404 });
    expect(assertConversation).toHaveBeenCalledWith(SCOPE, "web1");
    expect(getAction).toHaveBeenCalledWith(SCOPE, "draft1");
  });
});

describe("bounded assistant JSON", () => {
  it("accepts a UUID, optional conversation and trimmed text", async () => {
    await expect(readAssistantInput(json({ requestId: ID, conversationId: "web1", text: " Hello " }), signal())).resolves.toEqual({
      requestId: ID, conversationId: "web1", input: { kind: "text", text: "Hello" },
    });
  });
  it.each([
    { requestId: "not-a-uuid", text: "Hello" }, { requestId: ID, text: " " },
    { requestId: ID, text: "x".repeat(4_097) }, { requestId: ID, text: "Hello", businessId: "foreign" },
    { requestId: ID, text: "Hello", audio: "replacement" }, { requestId: ID, text: "Hello", conversationId: null },
    { requestId: ID, text: "Hello", duration: 5 }, [], null,
  ])("rejects invalid structure without forwarding input", async (body) => {
    await expect(readAssistantInput(json(body), signal())).rejects.toMatchObject({ statusCode: 422 });
  });
  it("rejects malformed JSON and UTF-8", async () => {
    for (const body of ["{", new Uint8Array([0xff])]) {
      const request = new NextRequest("https://sara.test", { method: "POST", headers: { "content-type": "application/json" }, body });
      await expect(readAssistantInput(request, signal())).rejects.toMatchObject({ statusCode: 422 });
    }
  });
  it("stops an oversize stream with no Content-Length before parsing it", async () => {
    const { request, cancel, pull } = streamed([
      new Uint8Array(MAX_ASSISTANT_JSON_BYTES), new Uint8Array(1), new Uint8Array(8_000),
    ]);
    const parse = vi.spyOn(request, "json");
    await expect(readAssistantInput(request, signal())).rejects.toMatchObject({ statusCode: 413 });
    expect(cancel).toHaveBeenCalledOnce();
    expect(pull).toHaveBeenCalledTimes(2);
    expect(parse).not.toHaveBeenCalled();
  });
  it("does not trust a small Content-Length", async () => {
    const { request } = streamed([new Uint8Array(MAX_ASSISTANT_JSON_BYTES + 1)], { "content-length": "1" });
    await expect(readAssistantInput(request, signal())).rejects.toMatchObject({ statusCode: 413 });
  });
  it("refuses a declared oversize body without acquiring its reader", async () => {
    const { request } = streamed([new Uint8Array(1)], { "content-length": String(MAX_ASSISTANT_JSON_BYTES + 1) });
    const read = vi.spyOn(request.body!, "getReader");
    await expect(readAssistantInput(request, signal())).rejects.toMatchObject({ statusCode: 413 });
    expect(read).not.toHaveBeenCalled();
  });
  it("cancels a pending read on abort without exposing the abort reason", async () => {
    const cancel = vi.fn();
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 });
    const init = {
      method: "POST", headers: { "content-type": "application/json" }, body, duplex: "half" as const,
    };
    const request = new NextRequest("https://sara.test", init);
    const reading = readAssistantInput(request, controller.signal);
    controller.abort("private owner text");
    await expect(reading).rejects.toMatchObject({ name: "AbortError", message: "Request aborted" });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("requires JSON for draft requests and accepts only conversationId", async () => {
    await expect(readAssistantDraftInput(json({ conversationId: "web1" }))).resolves.toEqual({ conversationId: "web1" });
    await expect(readAssistantDraftInput(json({ conversationId: "web1", payload: { amount: 1 } }))).rejects.toMatchObject({ statusCode: 422 });
    await expect(readAssistantDraftInput(multipart())).rejects.toMatchObject({ statusCode: 415 });
  });
  it("rejects unsupported request media", async () => {
    await expect(readAssistantInput(json({}, { "content-type": "text/plain" }), signal())).rejects.toMatchObject({ statusCode: 415 });
  });
});

describe("bounded assistant multipart", () => {
  it("provides a lazy server loader and ignores the original filename", async () => {
    const input = await readAssistantInput(multipart(), signal());
    expect(input).toMatchObject({ requestId: ID, conversationId: null, input: { kind: "audio" } });
    if (input.input.kind !== "audio") throw new Error("Expected audio");
    await expect(input.input.load(signal())).resolves.toEqual({ bytes: new TextEncoder().encode("voice"), mime: "audio/webm" });
  });
  it.each([
    (form: FormData) => form.append("audio", new File(["second"], "second.ogg", { type: "audio/ogg" })),
    (form: FormData) => form.append("requestId", ID),
    (form: FormData) => form.append("conversationId", new File(["id"], "id.txt")),
    (form: FormData) => form.append("text", "Also do this"),
    (form: FormData) => form.append("businessId", "biz_2"),
    (form: FormData) => form.append("duration", "1"),
    (form: FormData) => form.delete("audio"),
    (form: FormData) => form.set("audio", "not a file"),
    (form: FormData) => form.set("audio", new File([], "empty.webm", { type: "audio/webm" })),
  ])("rejects duplicate, mixed, empty and unknown fields", async (modify) => {
    await expect(readAssistantInput(multipart(modify), signal())).rejects.toMatchObject({ statusCode: 422 });
  });
  it("enforces the framing cap before FormData parsing", async () => {
    const { request, cancel } = streamed([
      new Uint8Array(MAX_ASSISTANT_MULTIPART_BYTES), new Uint8Array(1),
    ], { "content-type": "multipart/form-data; boundary=test" });
    const parse = vi.spyOn(Response.prototype, "formData");
    await expect(readAssistantInput(request, signal())).rejects.toMatchObject({ statusCode: 413 });
    expect(cancel).toHaveBeenCalledOnce();
    expect(parse).not.toHaveBeenCalled();
  });
  it("also caps the file when the bounded multipart framing fits", async () => {
    const request = multipart((form) => form.set("audio", new File([new Uint8Array(MAX_AUDIO_BYTES + 1)], "large.webm", { type: "audio/webm" })));
    await expect(readAssistantInput(request, signal())).rejects.toMatchObject({ statusCode: 413 });
  });
  it("rejects an unsupported audio MIME type", async () => {
    const request = multipart((form) => form.set("audio", new File(["png"], "image.png", { type: "image/png" })));
    await expect(readAssistantInput(request, signal())).rejects.toMatchObject({ statusCode: 415 });
  });
  it("rejects malformed multipart framing", async () => {
    const request = new NextRequest("https://sara.test", { method: "POST", headers: { "content-type": "multipart/form-data" }, body: "broken" });
    await expect(readAssistantInput(request, signal())).rejects.toMatchObject({ statusCode: 422 });
  });
  it("respects an aborted loader without reading file bytes", async () => {
    const input = await readAssistantInput(multipart(), signal());
    if (input.input.kind !== "audio") throw new Error("Expected audio");
    const controller = new AbortController(); controller.abort();
    const read = vi.spyOn(Blob.prototype, "arrayBuffer");
    await expect(input.input.load(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(read).not.toHaveBeenCalled();
  });
});
