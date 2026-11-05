import type { RecorderState } from "@/utils/audio-recorder";

export function VoiceStatus({ supported, state, error, waiting = false }: {
  supported: boolean;
  state: RecorderState;
  error: string | null;
  waiting?: boolean;
}) {
  const status = error ?? (waiting ? "One moment…" : state === "requesting"
    ? "Allow microphone access, then hold to talk. You can still type."
    : state === "recording" ? "Recording. Release to send, or cancel to discard."
    : state === "stopping" ? "Preparing your voice note…"
    : !supported ? "Voice recording is not supported in this browser. You can still type."
    : "Hold to talk, then release to send. Up to 2 minutes.");
  return <p role="status" aria-live="polite" aria-atomic="true" className="text-muted text-xs leading-relaxed">{status}</p>;
}
