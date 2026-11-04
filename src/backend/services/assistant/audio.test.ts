import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ parse: vi.fn(), create: vi.fn(), response: vi.fn(), available: true }));
vi.mock("music-metadata", () => ({ parseBuffer: mocks.parse, TrackType: { audio: 2, video: 1 } }));
vi.mock("./openai", () => ({ getOpenAI: () => ({ audio: { transcriptions: { create: mocks.create } } }) }));
vi.mock("./config", () => ({
  assistantConfig: () => ({ available: mocks.available, transcribeModel: "whisper-1" }),
  MAX_AUDIO_BYTES: 10 * 1024 * 1024,
  MAX_AUDIO_SECONDS: 120,
}));

import { AudioError, transcribeAudio, transcriptPrefix } from "./audio";

const signal = () => new AbortController().signal;
const ogg = () => ({ bytes: new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 1, 2, 3]), mime: "audio/ogg; codecs=opus" });
const metadata = (duration: number | undefined = 20) => ({ format: { container: "Ogg", duration, trackInfo: [{ type: 2, audio: {} }] } });
const result = (duration = 20, text = "Send an invoice") => ({
  data: { duration, text, language: "english" }, request_id: "req_audio_1", response: new Response(),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.available = true;
  mocks.parse.mockResolvedValue(metadata());
  mocks.response.mockResolvedValue(result());
  mocks.create.mockReturnValue({ withResponse: mocks.response });
});

describe("transcribeAudio", () => {
  it("uploads a transient Ogg file using English Whisper and the caller signal", async () => {
    const abortSignal = signal();
    expect(await transcribeAudio(ogg(), abortSignal)).toEqual({ text: "Send an invoice", seconds: 20, providerRequestId: "req_audio_1" });
    expect(mocks.parse).toHaveBeenCalledWith(ogg().bytes, { mimeType: "audio/ogg" }, { duration: true, skipCovers: true });
    expect(mocks.create).toHaveBeenCalledWith({ file: expect.objectContaining({ name: "voice.ogg", type: "audio/ogg" }), model: "whisper-1", language: "en", response_format: "verbose_json" }, { signal: abortSignal });
  });

  it("defers the loader and never invokes it while unavailable", async () => {
    const loader = vi.fn().mockResolvedValue(ogg());
    mocks.available = false;
    await expect(transcribeAudio(loader, signal())).rejects.toThrow("ASSISTANT_UNAVAILABLE");
    expect(loader).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.available = true;
    const abortSignal = signal();
    await transcribeAudio(loader, abortSignal);
    expect(loader).toHaveBeenCalledWith(abortSignal);
  });

  it("checks a pre-aborted signal before even loading audio", async () => {
    const controller = new AbortController();
    controller.abort("private reason");
    const loader = vi.fn();
    await expect(transcribeAudio(loader, controller.signal)).rejects.toMatchObject({ name: "AbortError", message: "Audio request aborted" });
    expect(loader).not.toHaveBeenCalled();
  });

  it.each(["audio/wav", "video/mp4", "application/octet-stream"])("rejects unsupported MIME %s before parsing or uploading", async (mime) => {
    await expect(transcribeAudio({ ...ogg(), mime }, signal())).rejects.toThrow("AUDIO_UNREADABLE");
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("bounds bytes before parsing", async () => {
    await expect(transcribeAudio({ bytes: new Uint8Array(10 * 1024 * 1024 + 1), mime: "audio/ogg" }, signal())).rejects.toThrow("AUDIO_TOO_LARGE");
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it("rejects corrupt bytes, parser errors and containers without audio", async () => {
    await expect(transcribeAudio({ bytes: new Uint8Array([1, 2]), mime: "audio/ogg" }, signal())).rejects.toThrow("AUDIO_UNREADABLE");
    mocks.parse.mockRejectedValueOnce(new Error("secret parser body"));
    await expect(transcribeAudio(ogg(), signal())).rejects.toMatchObject({ message: "AUDIO_UNREADABLE", cause: undefined });
    mocks.parse.mockResolvedValueOnce({ format: { container: "Ogg", trackInfo: [] } });
    await expect(transcribeAudio(ogg(), signal())).rejects.toThrow("AUDIO_UNREADABLE");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("accepts exactly 120 seconds and refuses 121 before uploading", async () => {
    mocks.parse.mockResolvedValueOnce(metadata(120));
    mocks.response.mockResolvedValueOnce(result(120));
    expect((await transcribeAudio(ogg(), signal())).seconds).toBe(120);
    mocks.create.mockClear();
    mocks.parse.mockResolvedValueOnce(metadata(121));
    await expect(transcribeAudio(ogg(), signal())).rejects.toMatchObject({ code: "AUDIO_TOO_LONG", userMessage: "Please send a voice note of 2 minutes or less, or type your request." });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([0, -1, NaN, Infinity])("rejects invalid container duration %s", async (duration) => {
    mocks.parse.mockResolvedValueOnce(metadata(duration));
    await expect(transcribeAudio(ogg(), signal())).rejects.toThrow("AUDIO_UNREADABLE");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("allows unknown container duration and exposes billed seconds on final overlength rejection", async () => {
    mocks.parse.mockResolvedValue({ format: { container: "Ogg", trackInfo: [{ type: 2 }] } });
    await transcribeAudio(ogg(), signal());
    mocks.response.mockResolvedValueOnce(result(121));
    await expect(transcribeAudio(ogg(), signal())).rejects.toMatchObject({ code: "AUDIO_TOO_LONG", audioSeconds: 121, providerRequestId: "req_audio_1" });
  });

  it.each(["", "   "])("refuses empty transcription while retaining provider usage", async (text) => {
    mocks.response.mockResolvedValueOnce(result(20, text));
    await expect(transcribeAudio(ogg(), signal())).rejects.toMatchObject({ code: "AUDIO_UNREADABLE", audioSeconds: 20, providerRequestId: "req_audio_1" });
  });

  it("refuses a no-speech result even if the provider returned text", async () => {
    const response = result();
    mocks.response.mockResolvedValueOnce({ ...response, data: { ...response.data, segments: [{ no_speech_prob: 0.99 }] } });
    await expect(transcribeAudio(ogg(), signal())).rejects.toMatchObject({ code: "AUDIO_UNREADABLE", audioSeconds: 20 });
  });

  it("retains explicit billed usage when duration is unreadable", async () => {
    mocks.response.mockResolvedValueOnce({ ...result(), data: { ...result().data, duration: NaN, usage: { type: "duration", seconds: 23 } } });
    await expect(transcribeAudio(ogg(), signal())).rejects.toMatchObject({ code: "AUDIO_UNREADABLE", audioSeconds: 23 });
  });

  it("redacts SDK errors and reports unknown billing after a request failed", async () => {
    mocks.response.mockRejectedValueOnce(Object.assign(new Error("https://private.invalid sk-secret"), { request_id: "req_failed", body: "private audio" }));
    try { await transcribeAudio(ogg(), signal()); throw new Error("expected failure"); } catch (error) {
      expect(error).toBeInstanceOf(AudioError);
      expect(error).toMatchObject({ message: "AUDIO_UNREADABLE", billingUnknown: true, providerRequestId: "req_failed", cause: undefined });
      expect(JSON.stringify(error)).not.toMatch(/private|sk-secret/);
    }
  });

  it("retains usage if cancellation arrives with the billed response", async () => {
    const controller = new AbortController();
    mocks.response.mockImplementationOnce(async () => { controller.abort(); return result(); });
    await expect(transcribeAudio(ogg(), controller.signal)).rejects.toMatchObject({ code: "AUDIO_UNREADABLE", audioSeconds: 20, providerRequestId: "req_audio_1" });
  });

  it.each([
    { mime: "audio/webm", bytes: [0x1a, 0x45, 0xdf, 0xa3], filename: "voice.webm" },
    { mime: "video/webm", bytes: [0x1a, 0x45, 0xdf, 0xa3], filename: "voice.webm" },
    { mime: "audio/mp4", bytes: [0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0], filename: "voice.mp4" },
    { mime: "audio/x-m4a", bytes: [0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0], filename: "voice.mp4" },
  ])("selects container filename for $mime", async ({ mime, bytes, filename }) => {
    await transcribeAudio({ bytes: new Uint8Array(bytes), mime }, signal());
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ file: expect.objectContaining({ name: filename }) }), expect.anything());
  });

  it("rejects video tracks even under an audio MIME", async () => {
    mocks.parse.mockResolvedValueOnce({ format: { container: "WebM", trackInfo: [{ type: 2 }, { type: 1 }] } });
    await expect(transcribeAudio({ bytes: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), mime: "audio/webm" }, signal())).rejects.toThrow("AUDIO_UNREADABLE");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("requires positive audio-track evidence for browser video/webm", async () => {
    mocks.parse.mockResolvedValueOnce({ format: { container: "WebM", numberOfChannels: 2, sampleRate: 48000, trackInfo: [] } });
    await expect(transcribeAudio({ bytes: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), mime: "video/webm" }, signal())).rejects.toThrow("AUDIO_UNREADABLE");
  });
});

describe("transcriptPrefix", () => {
  it("caps the prefix without changing the stored transcript", () => {
    const text = "a".repeat(250);
    expect(transcriptPrefix(text)).toBe(`🎙️ "${"a".repeat(199)}…"\n\n`);
    expect(text).toHaveLength(250);
  });
  it("preserves short text and counts Unicode code points", () => {
    expect(transcriptPrefix("Send it")).toBe('🎙️ "Send it"\n\n');
    expect(transcriptPrefix("😀".repeat(201))).toBe(`🎙️ "${"😀".repeat(199)}…"\n\n`);
  });
});
