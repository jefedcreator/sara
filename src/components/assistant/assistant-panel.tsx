"use client";

import { Microphone } from "@phosphor-icons/react/dist/ssr";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";

import { useAssistant } from "@/hooks/use-assistant";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
import { Button } from "@/primitives/Button";
import { Textarea } from "@/primitives/Input";
import { Modal } from "@/primitives/Modal";

import { DraftCard } from "./draft-card";
import { MessageList } from "./message-list";
import { VoiceStatus } from "./voice-status";

export function AssistantPanel({ open, onOpenChange, returnFocus }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus?: () => void;
}) {
  const assistant = useAssistant();
  const [text, setText] = useState("");
  const [now, setNow] = useState(() => new Date());
  const input = useRef<HTMLTextAreaElement>(null);
  const openRef = useRef(open);
  const pointer = useRef<{ element: HTMLButtonElement; id: number } | null>(null);
  const key = useRef<string | null>(null);
  const recorder = useVoiceRecorder({
    onAudio: (audio) => {
      key.current = null;
      releasePointer();
      if (openRef.current) assistant.sendAudio(audio);
    },
  });
  const { dispose, cancel, stop, start } = recorder;
  const recording = recorder.state !== "idle";
  const busy = assistant.busy || recording;

  const releasePointer = useCallback(() => {
    const captured = pointer.current;
    pointer.current = null;
    if (captured?.element.hasPointerCapture(captured.id)) {
      captured.element.releasePointerCapture(captured.id);
    }
  }, []);

  const cancelRecording = useCallback(() => {
    key.current = null;
    releasePointer();
    cancel();
  }, [cancel, releasePointer]);

  useEffect(() => {
    openRef.current = open;
    if (!open) {
      key.current = null;
      releasePointer();
      dispose();
      return;
    }
    const timer = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(timer);
  }, [open, dispose, releasePointer]);

  useEffect(() => () => {
    openRef.current = false;
    key.current = null;
    releasePointer();
    dispose();
  }, [dispose, releasePointer]);

  useEffect(() => {
    if (!open) return;
    const onHidden = () => { if (document.hidden) cancelRecording(); };
    window.addEventListener("blur", cancelRecording);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("blur", cancelRecording);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [open, cancelRecording]);

  function changeOpen(next: boolean) {
    openRef.current = next;
    if (!next) {
      key.current = null;
      releasePointer();
      dispose();
    }
    onOpenChange(next);
  }

  function sendText(event: FormEvent) {
    event.preventDefault();
    if (busy || pointer.current || key.current) return;
    if (assistant.sendText(text)) setText("");
  }

  function startPointerRecording(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !event.isPrimary || busy || pointer.current || key.current || !recorder.supported) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointer.current = { element: event.currentTarget, id: event.pointerId };
    void start();
  }

  function stopPointerRecording(event: PointerEvent<HTMLButtonElement>) {
    if (pointer.current?.id !== event.pointerId) return;
    event.preventDefault();
    releasePointer();
    stop();
  }

  function startKeyboardRecording(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (event.repeat || key.current || pointer.current || busy || !recorder.supported) return;
    key.current = event.key;
    void start();
  }

  function stopKeyboardRecording(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (key.current !== event.key) return;
    key.current = null;
    stop();
  }

  async function changeDraft() {
    await assistant.change();
    if (openRef.current) input.current?.focus();
  }

  return (
    <Modal open={open} onOpenChange={changeOpen}>
      <Modal.Portal className="sm:items-stretch sm:justify-items-end sm:p-0">
        <Modal.Content className="flex h-[85dvh] min-h-0 flex-col gap-4 sm:h-dvh sm:max-w-[440px] sm:rounded-none"
          onOpenAutoFocus={(event) => { event.preventDefault(); input.current?.focus(); }}
          onCloseAutoFocus={returnFocus ? (event) => { event.preventDefault(); returnFocus(); } : undefined}
          onEscapeKeyDown={cancelRecording}>
          <Modal.Handle />
          <div className="shrink-0">
            <Modal.Title>Sara</Modal.Title>
            <Modal.Description>Ask about your business, or hold to talk.</Modal.Description>
          </div>
          <Modal.Dismiss label="Close Sara" />
          <MessageList messages={assistant.messages} />
          {assistant.draft ? <DraftCard draft={assistant.draft} busy={busy} editing={assistant.editing} now={now}
            onApprove={() => { if (!recording && !pointer.current && !key.current) void assistant.approve(); }} onChange={() => { if (!recording && !pointer.current && !key.current) void changeDraft(); }} /> : null}
          <form onSubmit={sendText} className="grid shrink-0 gap-3 border-t border-line pt-4">
            <label htmlFor="sara-message" className="text-ink text-sm font-semibold">{assistant.editing && assistant.draft ? "What should change?" : "Message Sara"}</label>
            <Textarea ref={input} id="sara-message" value={text} rows={2} maxLength={4_096}
              className="max-h-[16dvh] min-h-16 resize-none" onChange={(event) => setText(event.target.value)} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={busy || !text.trim()} isLoading={assistant.busy}>Send</Button>
              <Button variant="secondary" size="sm" disabled={assistant.busy || !recorder.supported}
                className="touch-none" aria-describedby="sara-voice-help" aria-pressed={recorder.state === "recording"}
                onPointerDown={startPointerRecording} onPointerUp={stopPointerRecording}
                onPointerCancel={cancelRecording} onLostPointerCapture={() => { if (pointer.current) cancelRecording(); }}
                onKeyDown={startKeyboardRecording} onKeyUp={stopKeyboardRecording}
                onClick={(event) => event.preventDefault()} onContextMenu={(event) => event.preventDefault()}
                onBlur={() => { if (key.current) cancelRecording(); }}>
                <Microphone aria-hidden="true" />Hold to talk
              </Button>
              {recording ? <Button variant="ghost" size="sm" onClick={cancelRecording}>Cancel recording</Button> : null}
            </div>
            <div id="sara-voice-help">
              <VoiceStatus supported={recorder.supported} state={recorder.state} waiting={assistant.waiting} error={assistant.error ?? recorder.error} />
            </div>
            {assistant.canRetry ? <Button variant="secondary" size="sm" disabled={busy} onClick={assistant.retryMessage}>Retry message</Button> : null}
          </form>
        </Modal.Content>
      </Modal.Portal>
    </Modal>
  );
}
