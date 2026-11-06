import { env } from "@/env";
import { AudioError, normalizeAudioMime, throwIfAudioAborted, type AudioInput } from "@/backend/services/assistant/audio";
import { MAX_AUDIO_BYTES } from "@/backend/services/assistant/config";

// Keep aligned with the WhatsApp adapter's Graph version.
const GRAPH = "https://graph.facebook.com/v21.0";
const MAX_METADATA_BYTES = 16 * 1024;

export async function readBoundedBody(response: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  throwIfAudioAborted(signal);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new AudioError("AUDIO_UNREADABLE");
  const advertised = response.headers.get("content-length");
  if (advertised !== null) {
    if (!/^\d+$/.test(advertised)) {
      await response.body?.cancel().catch(() => undefined);
      throw new AudioError("AUDIO_UNREADABLE");
    }
    if (Number(advertised) > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new AudioError("AUDIO_TOO_LARGE");
    }
  }
  if (!response.body) throw new AudioError("AUDIO_UNREADABLE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      throwIfAudioAborted(signal);
      const { done, value } = await reader.read();
      throwIfAudioAborted(signal);
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw new AudioError("AUDIO_TOO_LARGE");
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throwIfAudioAborted(signal);
    if (error instanceof AudioError) throw error;
    throw new AudioError("AUDIO_UNREADABLE");
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

function trustedMediaUrl(value: unknown): URL {
  if (typeof value !== "string" || value.length > 8_192) throw new AudioError("AUDIO_UNREADABLE");
  let url: URL;
  try { url = new URL(value); } catch { throw new AudioError("AUDIO_UNREADABLE"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash ||
      !(url.hostname === "lookaside.fbsbx.com" || url.hostname.endsWith(".fbsbx.com") || url.hostname.endsWith(".fbcdn.net"))) {
    throw new AudioError("AUDIO_UNREADABLE");
  }
  return url;
}

/** The caller must resolve linked identity and reserve quota before invoking. */
export async function downloadWhatsAppAudio(mediaId: string, signal: AbortSignal): Promise<AudioInput> {
  throwIfAudioAborted(signal);
  if (!/^\d{1,100}$/.test(mediaId)) throw new AudioError("AUDIO_UNREADABLE");
  const token = env.WHATSAPP_TOKEN ?? process.env.WHATSAPP_TOKEN;
  if (!token) throw new AudioError("AUDIO_UNREADABLE");
  const options = { headers: { Authorization: `Bearer ${token}` }, redirect: "error" as const, signal };
  try {
    const metadataResponse = await fetch(`${GRAPH}/${mediaId}`, options);
    if (!metadataResponse.ok) {
      await metadataResponse.body?.cancel().catch(() => undefined);
      throw new AudioError("AUDIO_UNREADABLE");
    }
    const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedBody(metadataResponse, MAX_METADATA_BYTES, signal)));
    if (!raw || typeof raw !== "object" || !("url" in raw) || !("mime_type" in raw)) throw new AudioError("AUDIO_UNREADABLE");
    const url = trustedMediaUrl(raw.url);
    if (typeof raw.mime_type !== "string") throw new AudioError("AUDIO_UNREADABLE");
    const mime = normalizeAudioMime(raw.mime_type);
    if ("file_size" in raw) {
      if (typeof raw.file_size !== "number" || !Number.isSafeInteger(raw.file_size) || raw.file_size <= 0) throw new AudioError("AUDIO_UNREADABLE");
      if (raw.file_size > MAX_AUDIO_BYTES) throw new AudioError("AUDIO_TOO_LARGE");
    }
    throwIfAudioAborted(signal);
    const response = await fetch(url.toString(), options);
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new AudioError("AUDIO_UNREADABLE");
    }
    // Metadata is authoritative for MIME; any media response label must agree.
    const contentType = response.headers.get("content-type");
    if (contentType) {
      try {
        if (normalizeAudioMime(contentType) !== mime) throw new AudioError("AUDIO_UNREADABLE");
      } catch {
        await response.body?.cancel().catch(() => undefined);
        throw new AudioError("AUDIO_UNREADABLE");
      }
    }
    const bytes = await readBoundedBody(response, MAX_AUDIO_BYTES, signal);
    if (!bytes.byteLength) throw new AudioError("AUDIO_UNREADABLE");
    return { bytes, mime };
  } catch (error) {
    throwIfAudioAborted(signal);
    if (error instanceof AudioError) throw error;
    throw new AudioError("AUDIO_UNREADABLE");
  }
}
