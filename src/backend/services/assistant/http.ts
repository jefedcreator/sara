import { NextResponse, type NextRequest } from "next/server";
import type { ApiResponse } from "types";

import { authService } from "@/backend/services/auth";
import {
  assistantAudioFieldsSchema,
  assistantDraftValidatorSchema,
  assistantMessageValidatorSchema,
  assistantConversationIdSchema,
} from "@/backend/validators/assistant.validator";
import { SESSION_COOKIE } from "@/server/auth/shared";
import {
  ForbiddenException, HttpException, NotFoundException,
  UnauthorizedException, UnprocessableEntityException,
} from "@/utils/exceptions";

import { MAX_AUDIO_BYTES } from "./config";
import type { AssistantMessageInput } from "./index";
import { assertConversation, getAction } from "./store";
import type { AssistantScope } from "./types";

export const MAX_ASSISTANT_JSON_BYTES = 16 * 1024;
export const MAX_ASSISTANT_MULTIPART_BYTES = MAX_AUDIO_BYTES + 64 * 1024;
const AUDIO_TYPES = new Set(["audio/ogg", "audio/webm", "audio/mp4", "audio/m4a", "audio/x-m4a", "video/webm"]);

/** Authenticate before touching a body; web scope comes solely from a live owner session. */
export async function requireAssistantOwner(request: NextRequest): Promise<AssistantScope> {
  const session = await authService.sessionFromRequest(request);
  if (!session) throw new UnauthorizedException("Unauthorized");
  const business = session.user.business;
  if (!business || business.ownerId !== session.user.id) {
    throw new ForbiddenException("Business owner required");
  }
  // Auth prefers the cookie, even if an Authorization header is also present.
  if (request.cookies.get(SESSION_COOKIE)?.value &&
      request.headers.get("origin") !== new URL(request.url).origin) {
    throw new ForbiddenException("Same-origin request required");
  }
  return { businessId: business.id, principalId: session.user.id, channel: "WEB" };
}

function aborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Request aborted", "AbortError");
}

/** Bound streamed bytes before JSON/FormData parsing, regardless of Content-Length. */
async function readBounded(request: NextRequest, limit: number, signal: AbortSignal): Promise<ArrayBuffer> {
  aborted(signal);
  const length = request.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > limit) {
    throw new HttpException("Request body too large", 413);
  }
  if (!request.body) throw new UnprocessableEntityException("Request body required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const onAbort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    aborted(signal);
    while (true) {
      const chunk = await reader.read();
      aborted(signal);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        // Do not await a remote stream's cancellation before returning the cap error.
        void reader.cancel().catch(() => undefined);
        throw new HttpException("Request body too large", 413);
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes.buffer;
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

function mediaType(request: NextRequest): string {
  return request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

async function readJson(request: NextRequest, signal: AbortSignal): Promise<unknown> {
  if (mediaType(request) !== "application/json") throw new HttpException("Unsupported media type", 415);
  const bytes = await readBounded(request, MAX_ASSISTANT_JSON_BYTES, signal);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new UnprocessableEntityException("Invalid JSON body"); }
}

/** Parse a bounded text request or one audio file; defer file byte access to the service's quota guard. */
export async function readAssistantInput(request: NextRequest, signal: AbortSignal): Promise<{
  requestId: string;
  conversationId: string | null;
  input: AssistantMessageInput["input"];
}> {
  if (mediaType(request) === "application/json") {
    const parsed = assistantMessageValidatorSchema.safeParse(await readJson(request, signal));
    if (!parsed.success) throw new UnprocessableEntityException("Invalid assistant input");
    return {
      requestId: parsed.data.requestId, conversationId: parsed.data.conversationId ?? null,
      input: { kind: "text", text: parsed.data.text },
    };
  }
  if (mediaType(request) !== "multipart/form-data") throw new HttpException("Unsupported media type", 415);
  const bytes = await readBounded(request, MAX_ASSISTANT_MULTIPART_BYTES, signal);
  let form: FormData;
  try {
    form = await new Response(bytes, { headers: { "content-type": request.headers.get("content-type")! } }).formData();
  } catch { throw new UnprocessableEntityException("Invalid multipart body"); }
  aborted(signal);
  const fields: Record<string, string> = {};
  let audio: File | undefined;
  const seen = new Set<string>();
  for (const [key, value] of form.entries()) {
    if (!["requestId", "conversationId", "audio"].includes(key) || seen.has(key)) {
      throw new UnprocessableEntityException("Invalid assistant input");
    }
    seen.add(key);
    if (key === "audio") {
      if (typeof value === "string" || !value.name || value.size === 0) {
        throw new UnprocessableEntityException("One nonempty audio file required");
      }
      audio = value;
    } else {
      if (typeof value !== "string") throw new UnprocessableEntityException("Invalid assistant input");
      fields[key] = value;
    }
  }
  const parsed = assistantAudioFieldsSchema.safeParse(fields);
  if (!parsed.success || !audio) throw new UnprocessableEntityException("Invalid assistant input");
  if (audio.size > MAX_AUDIO_BYTES) throw new HttpException("Audio file too large", 413);
  const mime = audio.type.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!AUDIO_TYPES.has(mime)) throw new HttpException("Unsupported audio type", 415);
  const file = audio;
  return {
    requestId: parsed.data.requestId, conversationId: parsed.data.conversationId ?? null,
    input: { kind: "audio", load: async (loadSignal) => {
      aborted(signal); aborted(loadSignal);
      const audioBytes = new Uint8Array(await file.arrayBuffer());
      aborted(signal); aborted(loadSignal);
      return { bytes: audioBytes, mime };
    } },
  };
}

/** Read only the conversation binding; stored action payloads are never client inputs. */
export async function readAssistantDraftInput(request: NextRequest): Promise<{ conversationId: string }> {
  const parsed = assistantDraftValidatorSchema.safeParse(await readJson(request, request.signal));
  if (!parsed.success) throw new UnprocessableEntityException("Invalid assistant input");
  return parsed.data;
}

/** Check both scope and the exact action/conversation relationship before approval or editing. */
export async function requireAssistantAction(scope: AssistantScope, conversationId: string, actionId: string): Promise<void> {
  if (!assistantConversationIdSchema.safeParse(actionId).success) {
    throw new UnprocessableEntityException("Invalid action id");
  }
  await assertConversation(scope, conversationId);
  const action = await getAction(scope, actionId);
  if (action.conversationId !== conversationId) throw new NotFoundException("Draft not found");
}

/** Existing API success envelope, with no stored payloads or tenant identity. */
export function assistantResponse<T>(data: T): NextResponse<ApiResponse<T>> {
  return NextResponse.json({ status: 200, message: "Success", data });
}

/** Assistant-only exception envelope. Never log input, transcripts, file bytes or raw provider errors. */
export async function withAssistantOwner(
  request: NextRequest,
  handler: (scope: AssistantScope) => Promise<Response>,
): Promise<Response> {
  try { return await handler(await requireAssistantOwner(request)); }
  catch (error) {
    let status = 500;
    let message = "Internal server error";
    const code = error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
    if (error instanceof HttpException) { status = error.statusCode; message = error.message; }
    else if (code === "ASSISTANT_TIMEOUT") { status = 503; message = "That request took too long. Please try again."; }
    else if (code === "CONVERSATION_NOT_FOUND" || code === "ACTION_NOT_FOUND") { status = 404; message = "Conversation or draft not found"; }
    else if (code === "ASSISTANT_BUSY" || code === "ASSISTANT_TURN_STALE" ||
      code === "ASSISTANT_DRAFT_NOT_PENDING" || code === "ASSISTANT_DRAFT_EXPIRED" || code === "ASSISTANT_DRAFT_EDITING") {
      status = 409; message = code === "ASSISTANT_BUSY" ? "Please wait for your current request to finish." : "This draft is no longer available for approval.";
    } else if (error instanceof Error && error.name === "AbortError") { status = 400; message = "Request aborted"; }
    return NextResponse.json({ status, message }, { status });
  }
}
