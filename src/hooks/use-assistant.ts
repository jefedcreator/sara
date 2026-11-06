"use client";

import { isAxiosError } from "axios";
import { useEffect, useRef, useState } from "react";
import type { ActionResult, DraftDto } from "types";

import { canApproveDraft } from "@/components/assistant/draft-card";
import type { AssistantMessage } from "@/components/assistant/message-list";
import { useAssistantApproveMutation, useAssistantChangeMutation, useAssistantMessageMutation } from "@/hooks/mutations/use-assistant-mutations";
import type { AssistantMessageInput } from "@/utils/api";
import type { RecordedAudio } from "@/utils/audio-recorder";
import { nextAssistantDraftState } from "@/utils/assistant-draft-state";
import { errorMessage } from "@/utils/axios";

type Submission = { input: AssistantMessageInput; ownerId: string; wasEditing: boolean };

/** Conversation memory belongs to the persistent chrome, never local storage. */
export function useAssistant() {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [draft, setDraft] = useState<DraftDto | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<Submission | null>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  const sequence = useRef(0);
  const messageMutation = useAssistantMessageMutation();
  const approveMutation = useAssistantApproveMutation();
  const changeMutation = useAssistantChangeMutation();

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => setWaiting(true), 4_000);
    return () => clearTimeout(timer);
  }, [busy]);

  function begin() {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    setWaiting(false);
    setError(null);
    return true;
  }

  function finish() {
    locked.current = false;
    if (!mounted.current) return;
    setBusy(false);
    setWaiting(false);
  }

  function addReply(text: string, result: ActionResult | null = null) {
    const id = `sara-${++sequence.current}`;
    setMessages((current) => [...current, { id, role: "sara", text, result }]);
  }

  async function deliver(submission: Submission) {
    // begin() runs synchronously in the gesture/submit handler to close the
    // gap before React renders disabled controls on a second tap.
    try {
      const reply = await messageMutation.mutateAsync(submission.input);
      if (!mounted.current) return;
      setConversationId(reply.conversationId);
      setRetry(null);
      if (reply.transcript !== null) {
        setMessages((current) => current.map((message) => message.id === submission.ownerId
          ? { ...message, transcript: reply.transcript ?? undefined } : message));
      }
      addReply(reply.reply, reply.result);
      const next = nextAssistantDraftState(draft, reply.draft, submission.wasEditing,
        "text" in submission.input ? submission.input.text : undefined);
      setDraft(next.draft);
      setEditing(next.editing);
    } catch (cause) {
      if (!mounted.current) return;
      setError(errorMessage(cause, "Sara could not reply. Your message has not been confirmed."));
      // Only a transport failure offers upload/message retry. Reuse both the
      // same audio Blob and UUID; never create a second logical submission.
      setRetry(isAxiosError(cause) && !cause.response ? submission : null);
      // Restore editing state for non-retryable errors (HTTP 409/422, etc.)
      // so the draft remains actionable after the error is dismissed.
      if (!isAxiosError(cause) || cause.response) {
        setEditing(submission.wasEditing);
      }
    } finally {
      finish();
    }
  }

  function send(input: { text: string } | { audio: Blob; filename: string }) {
    if (!begin()) return false;
    let requestId: string;
    try {
      requestId = crypto.randomUUID();
    } catch {
      setError("Could not start this message. Please try again.");
      finish();
      return false;
    }
    const ownerId = `owner-${requestId}`;
    const submission = { input: { ...input, requestId, ...(conversationId ? { conversationId } : {}) }, ownerId, wasEditing: editing };
    setRetry(null);
    // A request may supersede the current draft even if its response is lost.
    // Keep that old summary visible but ineligible until the server replies.
    setEditing(true);
    setMessages((current) => [...current, { id: ownerId, role: "owner", text: "text" in input ? input.text : "Voice note" }]);
    void deliver(submission);
    return true;
  }

  function sendText(text: string) {
    const trimmed = text.trim();
    return trimmed ? send({ text: trimmed }) : false;
  }

  function sendAudio(audio: RecordedAudio) {
    return send({ audio: audio.blob, filename: audio.filename });
  }

  function retryMessage() {
    if (!retry || !begin()) return;
    void deliver(retry);
  }

  async function approve() {
    if (!conversationId || !draft || !canApproveDraft(draft, editing, new Date()) || !begin()) return;
    setRetry(null);
    const approvedDraft = draft;
    try {
      const reply = await approveMutation.mutateAsync({ conversationId, actionId: draft.id });
      if (!mounted.current) return;
      addReply(reply.reply, reply.result);
      // An absent replacement never leaves an old actionable approval behind.
      const status = reply.status === "approved" || reply.status === "already_done" ? "APPROVED"
        : reply.status === "expired" ? "EXPIRED" : reply.status === "cancelled" ? "CANCELLED" : "INVALID";
      setDraft(reply.draft ?? { ...approvedDraft, status });
      // Revalidation may return a newly rendered pending preview. It needs
      // another explicit Send it, and is not the draft being edited.
      setEditing(false);
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause, "Approval has not been confirmed. You can try Send it again to check this same draft."));
    } finally {
      finish();
    }
  }

  async function change() {
    if (!conversationId || !draft || !canApproveDraft(draft, editing, new Date()) || !begin()) return false;
    setRetry(null);
    // Disable approval immediately, including when the change reply is lost.
    setEditing(true);
    try {
      const reply = await changeMutation.mutateAsync({ conversationId, actionId: draft.id });
      if (!mounted.current) return false;
      setConversationId(reply.conversationId);
      setDraft(reply.draft);
      addReply(reply.reply);
      return true;
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause, "Could not confirm the change request. Type the correction below."));
      return false;
    } finally {
      finish();
    }
  }

  return { messages, draft, editing, busy, waiting, error, canRetry: retry !== null, sendText, sendAudio, retryMessage, approve, change };
}
