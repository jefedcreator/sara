import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAudioRecorder,
  type RecordedAudio,
  type RecorderState,
} from "./audio-recorder";

class FakeRecorder extends EventTarget {
  static instances: FakeRecorder[] = [];
  static supported = ["audio/webm;codecs=opus", "audio/mp4"];
  static nativeMime = "audio/ogg;codecs=opus";
  static finalBytes = "final audio";
  static isTypeSupported(mime: string) {
    return FakeRecorder.supported.includes(mime);
  }

  state: RecordingState = "inactive";
  mimeType: string;
  stop = vi.fn(() => {
    this.state = "inactive";
    queueMicrotask(() => {
      this.chunk(FakeRecorder.finalBytes);
      this.dispatchEvent(new Event("stop"));
    });
  });

  constructor(
    readonly stream: MediaStream,
    readonly options?: MediaRecorderOptions,
  ) {
    super();
    this.mimeType = options?.mimeType ?? FakeRecorder.nativeMime;
    FakeRecorder.instances.push(this);
  }

  start() {
    this.state = "recording";
  }

  chunk(bytes: string) {
    const event = new Event("dataavailable");
    Object.defineProperty(event, "data", {
      value: new Blob([bytes], { type: this.mimeType }),
    });
    this.dispatchEvent(event);
  }
}

function setup() {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  const stream = { getTracks: () => tracks } as unknown as MediaStream;
  const deps = {
    getUserMedia: vi.fn(async () => stream),
    MediaRecorder: FakeRecorder,
    onAudio: vi.fn<(audio: RecordedAudio) => void>(),
    onError: vi.fn<(message: string) => void>(),
    onState: vi.fn<(state: RecorderState) => void>(),
    setTimeout,
    clearTimeout,
    now: () => Date.now(),
  };
  return { deps, tracks, stream, controller: createAudioRecorder(deps) };
}

const flushEvents = async () => {
  await Promise.resolve();
};

describe("createAudioRecorder", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    FakeRecorder.instances = [];
    FakeRecorder.supported = ["audio/webm;codecs=opus", "audio/mp4"];
    FakeRecorder.nativeMime = "audio/ogg;codecs=opus";
    FakeRecorder.finalBytes = "final audio";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("releases every track when permission resolves after release outside the control", async () => {
    const { deps, stream, tracks } = setup();
    let resolve!: (value: MediaStream) => void;
    deps.getUserMedia.mockImplementation(
      () =>
        new Promise<MediaStream>((done) => {
          resolve = done;
        }),
    );
    const controller = createAudioRecorder(deps);
    const pending = controller.start();
    controller.stop();
    resolve(stream);
    await pending;
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
    expect(FakeRecorder.instances).toHaveLength(0);
    expect(deps.onAudio).not.toHaveBeenCalled();
    expect(deps.onState.mock.calls.map(([state]) => state)).toEqual([
      "requesting",
      "idle",
    ]);
  });

  it("surfaces permission refusal and allows another attempt", async () => {
    const { deps, controller } = setup();
    deps.getUserMedia.mockRejectedValueOnce({ name: "NotAllowedError" });
    await controller.start();
    expect(deps.onError).toHaveBeenCalledWith(
      "Microphone access was refused. You can still type.",
    );
    expect(deps.onState).toHaveBeenLastCalledWith("idle");
    await controller.start();
    expect(deps.onState).toHaveBeenLastCalledWith("recording");
    controller.dispose();
  });

  it.each(["getUserMedia", "MediaRecorder"] as const)(
    "handles missing %s without requesting permission",
    async (missing) => {
      const { deps } = setup();
      const controller = createAudioRecorder({ ...deps, [missing]: undefined });
      await controller.start();
      expect(deps.onError).toHaveBeenCalledWith(
        "Voice recording is not supported in this browser. You can still type.",
      );
      expect(deps.getUserMedia).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("waits for the final chunk, stops once and uploads once", async () => {
    const { controller, deps, tracks } = setup();
    await controller.start();
    const recorder = FakeRecorder.instances[0]!;
    recorder.chunk("first ");
    vi.advanceTimersByTime(1750);
    controller.stop();
    controller.stop();
    expect(deps.onAudio).not.toHaveBeenCalled();
    expect(deps.onState).toHaveBeenLastCalledWith("stopping");
    await flushEvents();
    expect(recorder.stop).toHaveBeenCalledOnce();
    expect(deps.onAudio).toHaveBeenCalledOnce();
    const audio = deps.onAudio.mock.calls[0]![0];
    expect(await audio.blob.text()).toBe("first final audio");
    expect(audio.blob.type).toBe("audio/webm;codecs=opus");
    expect(audio.filename).toBe("voice-note.webm");
    expect(audio.seconds).toBe(1.75);
    expect(deps.onState).toHaveBeenLastCalledWith("idle");
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    recorder.dispatchEvent(new Event("stop"));
    expect(deps.onAudio).toHaveBeenCalledOnce();
  });

  it.each([
    { supported: ["audio/mp4"], expected: "audio/mp4", extension: "mp4" },
    { supported: [], expected: "audio/ogg;codecs=opus", extension: "ogg" },
  ])(
    "preserves actual MIME and extension: $expected",
    async ({ supported, expected, extension }) => {
      FakeRecorder.supported = supported;
      const { controller, deps } = setup();
      await controller.start();
      controller.stop();
      await flushEvents();
      const audio = deps.onAudio.mock.calls[0]![0];
      expect(audio.blob.type).toBe(expected);
      expect(audio.filename).toBe(`voice-note.${extension}`);
      expect(FakeRecorder.instances[0]!.options).toEqual(
        supported.length ? { mimeType: expected } : undefined,
      );
    },
  );

  it.each(["cancel", "dispose"] as const)(
    "%s discards final events and cleans up immediately",
    async (action) => {
      const { controller, deps, tracks } = setup();
      await controller.start();
      controller[action]();
      for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      await flushEvents();
      expect(deps.onAudio).not.toHaveBeenCalled();
      if (action === "dispose") {
        await controller.start();
        expect(deps.getUserMedia).toHaveBeenCalledOnce();
      }
    },
  );

  it("cancellation while stopping discards the queued final upload", async () => {
    const { controller, deps } = setup();
    await controller.start();
    controller.stop();
    controller.cancel();
    await flushEvents();
    expect(deps.onAudio).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("automatically stops and uploads at the two-minute ceiling", async () => {
    const { controller, deps, tracks } = setup();
    await controller.start();
    vi.advanceTimersByTime(120_000);
    await flushEvents();
    expect(deps.onError).toHaveBeenCalledWith("Two-minute limit reached");
    expect(deps.onAudio).toHaveBeenCalledWith(
      expect.objectContaining({ seconds: 120 }),
    );
    expect(FakeRecorder.instances[0]!.stop).toHaveBeenCalledOnce();
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("discards zero-byte recordings", async () => {
    FakeRecorder.finalBytes = "";
    const { controller, deps, tracks } = setup();
    await controller.start();
    controller.stop();
    await flushEvents();
    expect(deps.onAudio).not.toHaveBeenCalled();
    expect(deps.onState).toHaveBeenLastCalledWith("idle");
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up recorder errors without uploading late final chunks", async () => {
    const { controller, deps, tracks } = setup();
    await controller.start();
    const recorder = FakeRecorder.instances[0]!;
    recorder.dispatchEvent(new Event("error"));
    await flushEvents();
    expect(deps.onError).toHaveBeenCalledWith(
      "Could not record audio. You can still type.",
    );
    expect(deps.onAudio).not.toHaveBeenCalled();
    expect(deps.onState).toHaveBeenLastCalledWith("idle");
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases a stream after disposal during permission", async () => {
    const { deps, stream, tracks } = setup();
    let resolve!: (value: MediaStream) => void;
    deps.getUserMedia.mockImplementation(
      () => new Promise<MediaStream>((done) => { resolve = done; }),
    );
    const controller = createAudioRecorder(deps);
    const pending = controller.start();
    controller.dispose();
    resolve(stream);
    await pending;
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
    expect(deps.onAudio).not.toHaveBeenCalled();
    expect(deps.onError).not.toHaveBeenCalled();
    expect(FakeRecorder.instances).toHaveLength(0);
  });

  it("does not let a stale permission failure affect a newer recording", async () => {
    const { deps, controller } = setup();
    let reject!: (reason: unknown) => void;
    deps.getUserMedia.mockImplementationOnce(
      () => new Promise<MediaStream>((_resolve, fail) => { reject = fail; }),
    );
    const stale = controller.start();
    controller.stop();
    await controller.start();
    reject({ name: "NotAllowedError" });
    await stale;
    expect(deps.onError).not.toHaveBeenCalled();
    expect(deps.onState).toHaveBeenLastCalledWith("recording");
    controller.dispose();
  });

  it("ignores a late permission success while a newer recording is active", async () => {
    const { deps, controller, tracks } = setup();
    const staleTrack = { stop: vi.fn() };
    let resolve!: (value: MediaStream) => void;
    deps.getUserMedia.mockImplementationOnce(
      () => new Promise<MediaStream>((done) => { resolve = done; }),
    );
    const stale = controller.start();
    controller.cancel();
    await controller.start();
    resolve({ getTracks: () => [staleTrack] } as unknown as MediaStream);
    await stale;
    expect(staleTrack.stop).toHaveBeenCalledOnce();
    for (const track of tracks) expect(track.stop).not.toHaveBeenCalled();
    expect(FakeRecorder.instances).toHaveLength(1);
    expect(deps.onState).toHaveBeenLastCalledWith("recording");
    controller.dispose();
  });

  it("ignores repeated starts during permission and recording", async () => {
    const { deps, controller } = setup();
    const pending = controller.start();
    await controller.start();
    await pending;
    await controller.start();
    expect(deps.getUserMedia).toHaveBeenCalledOnce();
    expect(FakeRecorder.instances).toHaveLength(1);
    controller.dispose();
  });

  it("cleans up if recorder construction fails", async () => {
    const { deps, tracks } = setup();
    class BrokenRecorder extends FakeRecorder {
      constructor(stream: MediaStream) {
        super(stream);
        throw new Error("unavailable encoder");
      }
    }
    const controller = createAudioRecorder({
      ...deps,
      MediaRecorder: BrokenRecorder,
    });
    await controller.start();
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
    expect(deps.onError).toHaveBeenCalledWith(
      "Could not record audio. You can still type.",
    );
    expect(deps.onState).toHaveBeenLastCalledWith("idle");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up if the browser rejects start", async () => {
    const { deps, tracks } = setup();
    class BrokenRecorder extends FakeRecorder {
      start() {
        throw new Error("start failed");
      }
    }
    const controller = createAudioRecorder({
      ...deps,
      MediaRecorder: BrokenRecorder,
    });
    await controller.start();
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
    expect(deps.onAudio).not.toHaveBeenCalled();
    expect(deps.onError).toHaveBeenCalledWith(
      "Could not record audio. You can still type.",
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up if the browser rejects stop", async () => {
    const { deps, tracks, controller } = setup();
    await controller.start();
    FakeRecorder.instances[0]!.stop.mockImplementation(() => {
      throw new Error("stop failed");
    });
    controller.stop();
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
    expect(deps.onAudio).not.toHaveBeenCalled();
    expect(deps.onError).toHaveBeenCalledWith(
      "Could not record audio. You can still type.",
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up a browser-initiated stop and ignores late error events", async () => {
    const { deps, tracks, controller } = setup();
    await controller.start();
    const recorder = FakeRecorder.instances[0]!;
    recorder.stop();
    await flushEvents();
    recorder.dispatchEvent(new Event("error"));
    expect(deps.onAudio).toHaveBeenCalledOnce();
    expect(deps.onError).not.toHaveBeenCalled();
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not let one broken track prevent the remaining track cleanup", async () => {
    const { deps, tracks, controller } = setup();
    await controller.start();
    tracks[0]!.stop.mockImplementation(() => {
      throw new Error("track ended");
    });
    controller.cancel();
    await flushEvents();
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
    expect(deps.onAudio).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not emit errors or state changes after disposal during permission", async () => {
    const { deps, controller } = setup();
    let reject!: (reason: unknown) => void;
    deps.getUserMedia.mockImplementationOnce(
      () => new Promise<MediaStream>((_resolve, fail) => { reject = fail; }),
    );
    const pending = controller.start();
    controller.dispose();
    deps.onState.mockClear();
    reject({ name: "NotAllowedError" });
    await pending;
    expect(deps.onState).not.toHaveBeenCalled();
    expect(deps.onError).not.toHaveBeenCalled();
    expect(deps.onAudio).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
