import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelAdapter, InboundMessage, OutboundMessage, SendResult } from "./channels/types";

vi.mock("./engine", () => ({ conversationEngine: { handle: vi.fn() } }));
import { conversationEngine } from "./engine";
import { processInboundBatch } from "./process";

const handle = vi.mocked(conversationEngine.handle);
const send = vi.fn<ChannelAdapter["send"]>();
const adapter: ChannelAdapter = {
  channel: "WHATSAPP", verify: vi.fn(), isAuthentic: vi.fn(), normalizeInbound: vi.fn(), send,
};
const message = (messageId: string, externalId = "owner-a", channel: InboundMessage["channel"] = "WHATSAPP"): InboundMessage => ({
  channel, externalId, messageId, kind: "text", text: "private request",
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.restoreAllMocks();
  handle.mockReset().mockResolvedValue({ text: "private reply" });
  send.mockReset().mockResolvedValue({ ok: true });
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("processInboundBatch", () => {
  it("waits for final delivery before handling the next message from a sender", async () => {
    const firstDelivery = deferred<SendResult>();
    const sending = deferred<void>();
    send.mockImplementationOnce(() => { sending.resolve(); return firstDelivery.promise; });
    let completed = false;
    const processing = processInboundBatch(adapter, [message("m1"), message("m2")]).then(() => { completed = true; });
    await sending.promise;
    expect(handle.mock.calls.map(([inbound]) => inbound.messageId)).toEqual(["m1"]);
    expect(completed).toBe(false);
    firstDelivery.resolve({ ok: true });
    await processing;
    expect(handle.mock.calls.map(([inbound]) => inbound.messageId)).toEqual(["m1", "m2"]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("starts independent sender groups while another sender is waiting", async () => {
    const blocked = deferred<OutboundMessage | null>();
    const otherStarted = deferred<void>();
    handle.mockImplementation(async (inbound) => {
      if (inbound.messageId === "a1") return blocked.promise;
      if (inbound.messageId === "b1") otherStarted.resolve();
      return null;
    });
    const processing = processInboundBatch(adapter, [message("a1"), message("a2"), message("b1", "owner-b")]);
    await otherStarted.promise;
    expect(handle.mock.calls.map(([inbound]) => inbound.messageId)).toEqual(["a1", "b1"]);
    blocked.resolve(null);
    await processing;
    expect(handle.mock.calls.map(([inbound]) => inbound.messageId)).toEqual(["a1", "b1", "a2"]);
  });

  it("keeps the same external ID on different channels in independent groups", async () => {
    const blocked = deferred<OutboundMessage | null>();
    const instagramStarted = deferred<void>();
    handle.mockImplementation(async (inbound) => {
      if (inbound.channel === "WHATSAPP") return blocked.promise;
      instagramStarted.resolve();
      return null;
    });
    const processing = processInboundBatch(adapter, [message("wa"), message("ig", "owner-a", "INSTAGRAM")]);
    await instagramStarted.promise;
    expect(handle).toHaveBeenCalledTimes(2);
    blocked.resolve(null);
    await processing;
  });

  it("isolates engine errors from later messages and other owners", async () => {
    handle.mockRejectedValueOnce(new Error("private transcript https://media.test/token"));
    await expect(processInboundBatch(adapter, [message("m1"), message("m2"), message("m3", "owner-b")])).resolves.toBeUndefined();
    expect(handle).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith("[Messaging] processing_failed", expect.objectContaining({ messageId: "m1", code: "PROCESSING_EXCEPTION" }));
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private transcript");
  });

  it.each(["result", "exception"] as const)("isolates a progress send %s failure and still sends the final reply", async (failure) => {
    if (failure === "result") send.mockResolvedValueOnce({ ok: false, code: 10 });
    else send.mockRejectedValueOnce(new Error("private progress, token=secret"));
    handle.mockImplementationOnce(async (_inbound, options) => {
      await options?.onProgress?.({ text: "One moment…" });
      return { text: "Finished" };
    });
    await processInboundBatch(adapter, [message("m1")]);
    expect(send).toHaveBeenNthCalledWith(1, "owner-a", { text: "One moment…" });
    expect(send).toHaveBeenNthCalledWith(2, "owner-a", { text: "Finished" });
    expect(console.warn).toHaveBeenCalledWith("[Messaging] delivery_failed", expect.objectContaining({ phase: "progress", code: failure === "result" ? 10 : "SEND_EXCEPTION" }));
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("secret");
  });

  it.each(["result", "exception"] as const)("isolates a final send %s failure and continues the batch", async (failure) => {
    if (failure === "result") send.mockResolvedValueOnce({ ok: false, code: 131047 });
    else send.mockRejectedValueOnce(new Error("private reply, token=secret"));
    await processInboundBatch(adapter, [message("m1"), message("m2"), message("m3", "owner-b")]);
    expect(handle).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenCalledTimes(3);
    expect(console.warn).toHaveBeenCalledWith("[Messaging] delivery_failed", expect.objectContaining({ phase: "final", code: failure === "result" ? 131047 : "SEND_EXCEPTION" }));
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("secret");
  });

  it("awaits progress delivery and preserves outbound controls", async () => {
    const progressDelivery = deferred<SendResult>();
    const sending = deferred<void>();
    send.mockImplementationOnce(() => { sending.resolve(); return progressDelivery.promise; });
    const reply = { text: "Exact summary", buttons: [{ id: "assistant:send:a", title: "Send it" }] };
    handle.mockImplementationOnce(async (_inbound, options) => {
      await options?.onProgress?.({ text: "One moment…" });
      return reply;
    });
    const processing = processInboundBatch(adapter, [message("m1")]);
    await sending.promise;
    expect(send).toHaveBeenCalledTimes(1);
    progressDelivery.resolve({ ok: true });
    await processing;
    expect(send).toHaveBeenLastCalledWith("owner-a", reply);
  });

  it("does not send for null replies or an empty batch", async () => {
    await processInboundBatch(adapter, []);
    expect(handle).not.toHaveBeenCalled();
    handle.mockResolvedValue(null);
    await processInboundBatch(adapter, [message("m1")]);
    expect(send).not.toHaveBeenCalled();
  });
});
