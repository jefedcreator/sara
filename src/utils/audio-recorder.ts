export type RecorderState = "idle" | "requesting" | "recording" | "stopping";

export interface RecordedAudio {
  blob: Blob;
  filename: string;
  seconds: number;
}

export interface AudioRecorderController {
  start(): Promise<void>;
  stop(): void;
  cancel(): void;
  dispose(): void;
}

/** The small browser surface also implemented by the node test recorder. */
export interface AudioRecorderInstance extends EventTarget {
  readonly state: RecordingState;
  readonly mimeType: string;
  start(): void;
  stop(): void;
}

export interface AudioRecorderConstructor {
  new (stream: MediaStream, options?: MediaRecorderOptions): AudioRecorderInstance;
  isTypeSupported?(mimeType: string): boolean;
}

export interface AudioRecorderDependencies {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  MediaRecorder?: AudioRecorderConstructor;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  now(): number;
  onState(state: RecorderState): void;
  onAudio(audio: RecordedAudio): void;
  onError(message: string): void;
}

const LIMIT_MS = 120_000;
const RECORDING_ERROR = "Could not record audio. You can still type.";

function extensionFor(mime: string) {
  switch (mime.split(";")[0]?.trim().toLowerCase()) {
    case "audio/webm":
    case "video/webm":
      return "webm";
    case "audio/mp4":
    case "video/mp4":
      return "mp4";
    case "audio/ogg":
    case "application/ogg":
      return "ogg";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/mpeg":
      return "mp3";
    default:
      return "bin";
  }
}

/** No browser globals are read until the caller injects them. */
export function createAudioRecorder(
  deps: AudioRecorderDependencies,
): AudioRecorderController {
  let generation = 0;
  let disposed = false;
  let state: RecorderState = "idle";
  let active: {
    discard(): void;
    stop(): void;
  } | null = null;

  function updateState(next: RecorderState) {
    state = next;
    if (!disposed) deps.onState(next);
  }

  function stopTracks(stream: MediaStream) {
    for (const track of stream.getTracks()) {
      // One broken track must not leave the remaining microphone tracks open.
      try {
        track.stop();
      } catch {
        // A track may already have been released by the browser.
      }
    }
  }

  function cancel() {
    generation++;
    const session = active;
    active = null;
    session?.discard();
    updateState("idle");
  }

  function stop() {
    if (state === "requesting") {
      cancel();
      return;
    }
    if (state !== "recording" || !active) return;
    const session = active;
    updateState("stopping");
    if (active === session) session.stop();
  }

  async function start() {
    if (disposed || state !== "idle") return;
    const Recorder = deps.MediaRecorder;
    const getUserMedia = deps.getUserMedia;
    if (!Recorder || !getUserMedia) {
      deps.onError(
        "Voice recording is not supported in this browser. You can still type.",
      );
      return;
    }

    const current = ++generation;
    updateState("requesting");
    if (disposed || current !== generation) return;
    let stream: MediaStream;
    try {
      stream = await getUserMedia({ audio: true });
    } catch (error) {
      if (disposed || current !== generation) return;
      updateState("idle");
      const name = (error as { name?: string } | null)?.name;
      deps.onError(
        name === "NotAllowedError" || name === "PermissionDeniedError"
          ? "Microphone access was refused. You can still type."
          : RECORDING_ERROR,
      );
      return;
    }

    // Releasing a hold while permission is pending must never begin recording.
    if (disposed || current !== generation) {
      stopTracks(stream);
      return;
    }

    let recorder: AudioRecorderInstance;
    try {
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4"].find(
        (mime) => Recorder.isTypeSupported?.(mime),
      );
      recorder = new Recorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      stopTracks(stream);
      updateState("idle");
      deps.onError(RECORDING_ERROR);
      return;
    }

    const chunks: Blob[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let released = false;
    let finished = false;
    let discarded = false;
    let startedAt = deps.now();
    let stoppedAt: number | undefined;

    function release() {
      if (timer !== undefined) {
        deps.clearTimeout(timer);
        timer = undefined;
      }
      if (!released) {
        released = true;
        stopTracks(stream);
      }
    }

    function detach() {
      recorder.removeEventListener("dataavailable", onData);
      recorder.removeEventListener("stop", finish);
      recorder.removeEventListener("error", onError);
    }

    function finish() {
      if (finished) return;
      finished = true;
      detach();
      release();
      if (discarded || disposed || current !== generation) return;
      active = null;
      updateState("idle");
      // Use the browser's actual container. Never relabel MP4/native bytes as WebM.
      const mimeType =
        recorder.mimeType || chunks.find((chunk) => chunk.type)?.type || "";
      const blob = new Blob(chunks, { type: mimeType });
      chunks.length = 0;
      if (!blob.size) return;
      deps.onAudio({
        blob,
        filename: `voice-note.${extensionFor(mimeType)}`,
        seconds:
          Math.min(LIMIT_MS, Math.max(0, (stoppedAt ?? deps.now()) - startedAt)) /
          1000,
      });
    }

    function discard() {
      discarded = true;
      finished = true;
      detach();
      chunks.length = 0;
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        // Cleanup still runs when the browser rejects a redundant stop.
      } finally {
        release();
      }
    }

    function onData(event: Event) {
      if (discarded || finished || disposed || current !== generation) return;
      const data = (event as BlobEvent).data;
      if (data.size) chunks.push(data);
    }

    function onError() {
      if (discarded || finished || disposed || current !== generation) return;
      active = null;
      discard();
      updateState("idle");
      deps.onError(RECORDING_ERROR);
    }

    const session = {
      discard,
      stop() {
        stoppedAt = deps.now();
        if (timer !== undefined) {
          deps.clearTimeout(timer);
          timer = undefined;
        }
        try {
          // If inactive, the browser's final dataavailable/stop may be queued.
          if (recorder.state !== "inactive") recorder.stop();
        } catch {
          onError();
        } finally {
          release();
        }
      },
    };
    active = session;
    recorder.addEventListener("dataavailable", onData);
    recorder.addEventListener("stop", finish);
    recorder.addEventListener("error", onError);
    try {
      recorder.start();
      startedAt = deps.now();
      if (active !== session || finished || discarded) return;
      updateState("recording");
      if (
        active !== session ||
        finished ||
        discarded ||
        stoppedAt !== undefined
      ) {
        return;
      }
      timer = deps.setTimeout(() => {
        if (active !== session || current !== generation || disposed) return;
        deps.onError("Two-minute limit reached");
        stop();
      }, LIMIT_MS);
    } catch {
      onError();
    }
  }

  return {
    start,
    stop,
    cancel,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancel();
    },
  };
}
