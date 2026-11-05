"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createAudioRecorder,
  type AudioRecorderController,
  type RecordedAudio,
  type RecorderState,
} from "@/utils/audio-recorder";

interface UseVoiceRecorderOptions {
  onAudio(audio: RecordedAudio): void;
}

export function useVoiceRecorder({ onAudio }: UseVoiceRecorderOptions) {
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);
  const mounted = useRef(false);
  const controller = useRef<AudioRecorderController | null>(null);
  const onAudioRef = useRef(onAudio);

  useEffect(() => {
    onAudioRef.current = onAudio;
  }, [onAudio]);

  useEffect(() => {
    mounted.current = true;
    setSupported(
      typeof window.MediaRecorder === "function" &&
        typeof navigator.mediaDevices?.getUserMedia === "function",
    );
    return () => {
      mounted.current = false;
      controller.current?.dispose();
      controller.current = null;
    };
  }, []);

  const start = useCallback(async () => {
    if (!mounted.current) return;
    setError(null);
    if (!controller.current) {
      controller.current = createAudioRecorder({
        getUserMedia: navigator.mediaDevices?.getUserMedia
          ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
          : undefined,
        MediaRecorder: window.MediaRecorder,
        setTimeout,
        clearTimeout,
        now: () => performance.now(),
        onAudio: (audio) => {
          if (mounted.current) onAudioRef.current(audio);
        },
        onState: (next) => {
          if (mounted.current) setState(next);
        },
        onError: (message) => {
          if (mounted.current) setError(message);
        },
      });
    }
    await controller.current.start();
  }, []);

  const stop = useCallback(() => controller.current?.stop(), []);
  const cancel = useCallback(() => controller.current?.cancel(), []);

  // The panel may stay mounted when closed. Discard now; recreate on next hold.
  const dispose = useCallback(() => {
    controller.current?.dispose();
    controller.current = null;
    if (mounted.current) setState("idle");
  }, []);

  return { start, stop, cancel, dispose, state, error, supported };
}
