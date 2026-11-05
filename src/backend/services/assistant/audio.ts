import { parseBuffer, TrackType } from "music-metadata";
import { toFile } from "openai";

import { assistantConfig, MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS } from "./config";
import { getOpenAI } from "./openai";

export type AudioInput = { bytes: Uint8Array; mime: string };
/** Call only after identity, availability and quota checks have succeeded. */
export type AudioLoader = (signal: AbortSignal) => Promise<AudioInput>;
export type AudioErrorCode = "AUDIO_TOO_LONG" | "AUDIO_TOO_LARGE" | "AUDIO_UNREADABLE";
export type AudioUsage = {
  audioSeconds?: number;
  providerRequestId?: string;
  billingUnknown?: boolean;
};

export class AudioError extends Error {
  readonly userMessage: string;
  readonly audioSeconds?: number;
  readonly providerRequestId?: string;
  readonly billingUnknown?: boolean;

  constructor(readonly code: AudioErrorCode, usage: AudioUsage = {}) {
    super(code);
    this.name = "AudioError";
    this.userMessage = code === "AUDIO_TOO_LONG"
      ? "Please send a voice note of 2 minutes or less, or type your request."
      : "Sorry, I couldn't make that out. Could you try again, or type it?";
    this.audioSeconds = usage.audioSeconds;
    this.providerRequestId = usage.providerRequestId;
    this.billingUnknown = usage.billingUnknown;
  }
}

/** Never expose a caller-supplied abort reason, which may contain private data. */
export function throwIfAudioAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Audio request aborted", "AbortError");
}

export function normalizeAudioMime(mime: string): string {
  const normalized = mime.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!["audio/ogg", "audio/webm", "audio/mp4", "audio/m4a", "audio/x-m4a", "video/webm"].includes(normalized)) {
    throw new AudioError("AUDIO_UNREADABLE");
  }
  return normalized;
}

function filenameFor(bytes: Uint8Array, mime: string): string {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (mime === "audio/ogg" && starts(0x4f, 0x67, 0x67, 0x53)) return "voice.ogg";
  if ((mime === "audio/webm" || mime === "video/webm") && starts(0x1a, 0x45, 0xdf, 0xa3)) return "voice.webm";
  if (["audio/mp4", "audio/m4a", "audio/x-m4a"].includes(mime) && bytes.length >= 12 &&
      bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return "voice.mp4";
  throw new AudioError("AUDIO_UNREADABLE");
}

function safeRequestId(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value) ? value : undefined;
}

export async function transcribeAudio(
  source: AudioInput | AudioLoader,
  signal: AbortSignal,
  beforePaidCall?: () => Promise<void>,
): Promise<{ text: string; seconds: number; providerRequestId?: string }> {
  throwIfAudioAborted(signal);
  // This check also prevents a lazy loader from downloading when switched off.
  if (!assistantConfig().available) throw new Error("ASSISTANT_UNAVAILABLE");
  let audio: AudioInput | undefined;
  let attempted = false;
  let usage: AudioUsage = {};
  try {
    audio = typeof source === "function" ? await source(signal) : source;
    throwIfAudioAborted(signal);
    if (audio.bytes.byteLength > MAX_AUDIO_BYTES) throw new AudioError("AUDIO_TOO_LARGE");
    const mime = normalizeAudioMime(audio.mime);
    const filename = filenameFor(audio.bytes, mime);
    const metadata = await parseBuffer(audio.bytes, { mimeType: mime }, { duration: true, skipCovers: true });
    throwIfAudioAborted(signal);
    const { format } = metadata;
    const tracks = format.trackInfo;
    const hasAudio = tracks.some((track) => track.type === TrackType.audio || track.audio !== undefined);
    if (!format.container || tracks.some((track) => track.type === TrackType.video || track.video !== undefined) ||
        (!hasAudio && !(mime !== "video/webm" && (format.numberOfChannels ?? 0) > 0 && (format.sampleRate ?? 0) > 0))) {
      throw new AudioError("AUDIO_UNREADABLE");
    }
    // Browser video/webm must be positively identified as audio-only.
    if (mime === "video/webm" && tracks.some((track) => track.type !== TrackType.audio && !track.audio)) {
      throw new AudioError("AUDIO_UNREADABLE");
    }
    for (const duration of [format.duration, format.containerDuration, ...tracks.map((track) => track.duration)]) {
      if (duration === undefined) continue;
      if (!Number.isFinite(duration) || duration <= 0) throw new AudioError("AUDIO_UNREADABLE");
      if (duration > MAX_AUDIO_SECONDS) throw new AudioError("AUDIO_TOO_LONG");
    }
    const file = await toFile(audio.bytes, filename, { type: mime === "video/webm" ? "audio/webm" : mime });
    throwIfAudioAborted(signal);
    await beforePaidCall?.();
    throwIfAudioAborted(signal);
    attempted = true;
    const { data: result, request_id } = await getOpenAI().audio.transcriptions.create({
      file,
      model: assistantConfig().transcribeModel,
      language: "en",
      response_format: "verbose_json",
    }, { signal }).withResponse();
    const reportedSeconds = result.usage?.seconds;
    const billedSeconds = reportedSeconds !== undefined && Number.isFinite(reportedSeconds) && reportedSeconds > 0
      ? reportedSeconds : result.duration;
    usage = {
      ...(Number.isFinite(billedSeconds) && billedSeconds > 0 ? { audioSeconds: billedSeconds } : { billingUnknown: true }),
      providerRequestId: safeRequestId(request_id),
    };
    // Validate after recording provider usage; rejected long/no-speech audio was billed too.
    if (!Number.isFinite(result.duration) || result.duration <= 0) throw new AudioError("AUDIO_UNREADABLE", usage);
    if (result.duration > MAX_AUDIO_SECONDS) throw new AudioError("AUDIO_TOO_LONG", usage);
    const text = result.text.trim();
    if (!text || text.length > 16_000 || (result.segments?.length && result.segments.every((segment) => segment.no_speech_prob >= 0.9))) {
      throw new AudioError("AUDIO_UNREADABLE", usage);
    }
    if (signal.aborted) throw new AudioError("AUDIO_UNREADABLE", usage);
    return { text, seconds: usage.audioSeconds ?? result.duration, providerRequestId: usage.providerRequestId };
  } catch (error) {
    if (error instanceof AudioError) throw error;
    if (!attempted) {
      throwIfAudioAborted(signal);
      throw new AudioError("AUDIO_UNREADABLE");
    }
    // Do not attach SDK errors or causes: those can contain body, URL or headers.
    const requestId = error !== null && typeof error === "object" && "request_id" in error
      ? safeRequestId(error.request_id) : undefined;
    throw new AudioError("AUDIO_UNREADABLE", { ...usage, providerRequestId: usage.providerRequestId ?? requestId, billingUnknown: usage.audioSeconds === undefined });
  } finally {
    // Buffers remain in request memory only. Do not mutate caller-owned buffers.
    audio = undefined;
  }
}

export function transcriptPrefix(text: string): string {
  const points = Array.from(text);
  const prefix = points.length > 200 ? `${points.slice(0, 199).join("")}…` : text;
  return `🎙️ "${prefix}"\n\n`;
}
