import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({ env: { WHATSAPP_TOKEN: "private-token" } }));
vi.mock("@/backend/services/assistant/config", () => ({ MAX_AUDIO_BYTES: 10 * 1024 * 1024 }));

import { downloadWhatsAppAudio, readBoundedBody } from "./media";

const fetchMock = vi.fn<typeof fetch>();
const signal = () => new AbortController().signal;
const metadata = (overrides: Record<string, unknown> = {}) => Response.json({
  url: "https://lookaside.fbsbx.com/whatsapp_business/attachments?token=private-url",
  mime_type: "audio/ogg; codecs=opus", file_size: 4, ...overrides,
});
const media = () => new Response(new Uint8Array([0x4f, 0x67, 0x67, 0x53]), { headers: { "content-type": "audio/ogg" } });

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe("readBoundedBody", () => {
  it("stops reading a stream without Content-Length at the byte cap", async () => {
    const cancelled = vi.fn();
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(5)); controller.enqueue(new Uint8Array(6)); },
      cancel: cancelled,
    }));
    await expect(readBoundedBody(response, 10, signal())).rejects.toThrow("AUDIO_TOO_LARGE");
    expect(cancelled).toHaveBeenCalled();
  });

  it("accepts exactly the limit and combines chunks in order", async () => {
    const response = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array([1, 2])); controller.enqueue(new Uint8Array([3, 4])); controller.close();
    } }));
    expect(await readBoundedBody(response, 4, signal())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("rejects advertised overlength without reading the body", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), { headers: { "content-length": "11" } });
    await expect(readBoundedBody(response, 10, signal())).rejects.toThrow("AUDIO_TOO_LARGE");
    expect(cancel).toHaveBeenCalled();
  });

  it("enforces streamed size even with a smaller advertised length", async () => {
    await expect(readBoundedBody(new Response(new Uint8Array(11), { headers: { "content-length": "1" } }), 10, signal())).rejects.toThrow("AUDIO_TOO_LARGE");
  });

  it("cancels a stalled stream when the signal aborts", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const reading = readBoundedBody(new Response(new ReadableStream({ cancel })), 10, controller.signal);
    controller.abort("private reason");
    await expect(reading).rejects.toMatchObject({ name: "AbortError", message: "Audio request aborted" });
    expect(cancel).toHaveBeenCalled();
  });

  it("sanitizes stream read failures", async () => {
    const response = new Response(new ReadableStream({ start(controller) { controller.error(new Error("private media URL")); } }));
    await expect(readBoundedBody(response, 10, signal())).rejects.toMatchObject({ message: "AUDIO_UNREADABLE", cause: undefined });
  });
});

describe("downloadWhatsAppAudio", () => {
  it("fetches bounded Graph metadata then a trusted media URL with abort and no redirects", async () => {
    fetchMock.mockResolvedValueOnce(metadata()).mockResolvedValueOnce(media());
    const abortSignal = signal();
    expect(await downloadWhatsAppAudio("1234", abortSignal)).toEqual({ bytes: new Uint8Array([0x4f, 0x67, 0x67, 0x53]), mime: "audio/ogg" });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://graph.facebook.com/v21.0/1234", { headers: { Authorization: "Bearer private-token" }, signal: abortSignal, redirect: "error" });
    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.stringContaining("https://lookaside.fbsbx.com/"), { headers: { Authorization: "Bearer private-token" }, signal: abortSignal, redirect: "error" });
  });

  it.each(["https://a.fbsbx.com/audio", "https://a.fbcdn.net/audio", "https://a.b.fbcdn.net/audio", "https://lookaside.fbsbx.com:443/audio"])("accepts trusted CDN %s", async (url) => {
    fetchMock.mockResolvedValueOnce(metadata({ url })).mockResolvedValueOnce(media());
    await downloadWhatsAppAudio("123", signal());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    "http://lookaside.fbsbx.com/audio", "https://lookaside.fbsbx.com.evil.test/audio",
    "https://fbcdn.net/audio", "https://fbsbx.com/audio", "https://evil.test/audio",
    "https://user:secret@lookaside.fbsbx.com/audio", "https://lookaside.fbsbx.com:444/audio",
    "https://lookaside.fbsbx.com/audio#private", "file:///private/audio", "not a url",
  ])("refuses untrusted media destinations without forwarding the token: %s", async (url) => {
    fetchMock.mockResolvedValueOnce(metadata({ url }));
    await expect(downloadWhatsAppAudio("123", signal())).rejects.toThrow("AUDIO_UNREADABLE");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["../messages", "123?url=private", "https://evil.test", ""])("rejects non-media IDs before a request: %s", async (id) => {
    await expect(downloadWhatsAppAudio(id, signal())).rejects.toThrow("AUDIO_UNREADABLE");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sanitizes Graph metadata HTTP errors without reading their body", async () => {
    const response = new Response("private token and body", { status: 403 });
    fetchMock.mockResolvedValueOnce(response);
    await expect(downloadWhatsAppAudio("123", signal())).rejects.toMatchObject({ message: "AUDIO_UNREADABLE", cause: undefined });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sanitizes media HTTP errors and network errors", async () => {
    fetchMock.mockResolvedValueOnce(metadata()).mockResolvedValueOnce(new Response("private", { status: 500 }));
    await expect(downloadWhatsAppAudio("123", signal())).rejects.toThrow("AUDIO_UNREADABLE");
    fetchMock.mockRejectedValueOnce(new Error("private-token private-url"));
    await expect(downloadWhatsAppAudio("123", signal())).rejects.toMatchObject({ message: "AUDIO_UNREADABLE", cause: undefined });
  });

  it("bounds metadata with and without advertised length", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x".repeat(16 * 1024 + 1)));
    await expect(downloadWhatsAppAudio("123", signal())).rejects.toThrow("AUDIO_TOO_LARGE");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses corrupt metadata without downloading audio", async () => {
    fetchMock.mockResolvedValueOnce(new Response("private invalid json"));
    await expect(downloadWhatsAppAudio("123", signal())).rejects.toThrow("AUDIO_UNREADABLE");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["video/mp4", "image/jpeg", "application/octet-stream"])("rejects wrong metadata MIME %s before downloading", async (mime_type) => {
    fetchMock.mockResolvedValueOnce(metadata({ mime_type }));
    await expect(downloadWhatsAppAudio("123", signal())).rejects.toThrow("AUDIO_UNREADABLE");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects wrong media MIME", async () => {
    fetchMock.mockResolvedValueOnce(metadata()).mockResolvedValueOnce(new Response("wrong", { headers: { "content-type": "video/mp4" } }));
    await expect(downloadWhatsAppAudio("123", signal())).rejects.toThrow("AUDIO_UNREADABLE");
  });

  it("refuses advertised oversized files before the media request", async () => {
    fetchMock.mockResolvedValueOnce(metadata({ file_size: 10 * 1024 * 1024 + 1 }));
    await expect(downloadWhatsAppAudio("123", signal())).rejects.toThrow("AUDIO_TOO_LARGE");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bounds the media stream even when metadata omitted file_size", async () => {
    const data = { url: "https://lookaside.fbsbx.com/audio", mime_type: "audio/ogg" };
    fetchMock.mockResolvedValueOnce(Response.json(data)).mockResolvedValueOnce(new Response(new Uint8Array(10 * 1024 * 1024 + 1)));
    await expect(downloadWhatsAppAudio("123", signal())).rejects.toThrow("AUDIO_TOO_LARGE");
  });

  it("makes no request when already aborted", async () => {
    const controller = new AbortController(); controller.abort("private reason");
    await expect(downloadWhatsAppAudio("123", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops before the media request if cancelled after metadata", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(async () => { controller.abort(); return metadata(); });
    await expect(downloadWhatsAppAudio("123", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
