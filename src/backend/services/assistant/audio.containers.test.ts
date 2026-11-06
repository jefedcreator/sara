import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Exercise the real container parser; the paid transcription transport stays mocked.
const mocks = vi.hoisted(() => ({ create: vi.fn(), response: vi.fn() }));
vi.mock("./openai", () => ({ getOpenAI: () => ({ audio: { transcriptions: { create: mocks.create } } }) }));
vi.mock("./config", () => ({
  assistantConfig: () => ({ available: true, transcribeModel: "whisper-1" }),
  MAX_AUDIO_BYTES: 10 * 1024 * 1024, MAX_AUDIO_SECONDS: 120,
}));

import { transcribeAudio } from "./audio";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockReturnValue({ withResponse: mocks.response });
  mocks.response.mockResolvedValue({ data: { text: "Synthetic parser fixture", duration: 0.2 }, request_id: "req_fixture" });
});

describe("real audio containers", () => {
  it.each([
    { fixture: "tone.ogg", mime: "audio/ogg; codecs=opus", filename: "voice.ogg", type: "audio/ogg" },
    { fixture: "tone.webm", mime: "audio/webm; codecs=opus", filename: "voice.webm", type: "audio/webm" },
    { fixture: "tone.webm", mime: "video/webm", filename: "voice.webm", type: "audio/webm" },
    { fixture: "tone.mp4", mime: "audio/mp4", filename: "voice.mp4", type: "audio/mp4" },
    { fixture: "tone.mp4", mime: "audio/x-m4a", filename: "voice.mp4", type: "audio/x-m4a" },
  ])("parses $fixture as $mime before uploading a correctly named file", async ({ fixture, mime, filename, type }) => {
    const bytes = new Uint8Array(await readFile(new URL(`./fixtures/${fixture}`, import.meta.url)));
    expect(await transcribeAudio({ bytes, mime }, new AbortController().signal)).toEqual({
      text: "Synthetic parser fixture", seconds: 0.2, providerRequestId: "req_fixture",
    });
    const upload: unknown = mocks.create.mock.calls[0]?.[0];
    expect(upload).toMatchObject({ file: { name: filename, type } });
  });
});
