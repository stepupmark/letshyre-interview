import { act, renderHook } from "@testing-library/react";
import { SILENCE_PEAK, WARMUP_MS, useAudioRecorder } from "./useAudioRecorder";

let inputPeak = 0.3;
let contextState = "running";

class FakeRecorder {
  static bytes = 5_000;
  static last = null;
  static isTypeSupported = (type) => type === "audio/webm;codecs=opus";

  constructor(stream, options) {
    this.mimeType = options?.mimeType ?? "";
    this.state = "inactive";
    this.start = vi.fn(() => {
      this.state = "recording";
    });
    FakeRecorder.last = this;
  }

  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array(FakeRecorder.bytes)]) });
    this.onstop?.();
  }
}

class FakeAudioContext {
  get state() {
    return contextState;
  }
  resume = () => Promise.resolve();
  close = () => Promise.resolve();
  createMediaStreamSource = () => ({ connect: () => {} });
  createAnalyser = () => ({
    fftSize: 1024,
    getFloatTimeDomainData: (samples) => samples.fill(inputPeak),
  });
}

class FakeAudio {
  static play = vi.fn();
  static last = null;
  paused = true;
  constructor(src) {
    this.src = src;
    FakeAudio.last = this;
  }
  addEventListener = vi.fn();
  pause = vi.fn(() => {
    this.paused = true;
  });
  play() {
    this.paused = false;
    return FakeAudio.play();
  }
}

let track;

beforeEach(() => {
  vi.useFakeTimers();
  inputPeak = 0.3;
  contextState = "running";
  FakeRecorder.bytes = 5_000;
  FakeAudio.play.mockReset().mockResolvedValue(undefined);

  track = { stop: vi.fn(), label: "Mic", muted: false, getSettings: () => ({}) };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };

  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("Audio", FakeAudio);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue(stream),
      enumerateDevices: vi.fn().mockResolvedValue([]),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
  URL.createObjectURL = vi.fn(() => "blob:recording");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function start(result) {
  await act(async () => {
    const pending = result.current.startRecording();
    await vi.advanceTimersByTimeAsync(WARMUP_MS);
    await pending;
  });
}

async function record(result, speakMs = 1_000) {
  await start(result);
  await act(() => vi.advanceTimersByTimeAsync(speakMs));
  act(() => result.current.stopRecording());
}

describe("useAudioRecorder", () => {
  it("waits for the mic to warm up before recording", async () => {
    const { result } = renderHook(() => useAudioRecorder());

    await act(async () => {
      result.current.startRecording();
      await vi.advanceTimersByTimeAsync(WARMUP_MS - 50);
    });
    expect(result.current.status).toBe("starting");
    expect(FakeRecorder.last.start).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(50));
    expect(result.current.status).toBe("recording");
  });

  it("keeps a recording with sound and releases the mic", async () => {
    const { result } = renderHook(() => useAudioRecorder());
    await record(result);

    expect(result.current.status).toBe("reviewing");
    expect(result.current.audioURL).toBe("blob:recording");
    expect(result.current.audioBlob.type).toBe("audio/webm;codecs=opus");
    expect(track.stop).toHaveBeenCalled();
  });

  it("refuses a recording whose input never rose above silence", async () => {
    inputPeak = SILENCE_PEAK / 2;
    const { result } = renderHook(() => useAudioRecorder());
    await record(result);

    expect(result.current.status).toBe("idle");
    expect(result.current.audioBlob).toBeNull();
    expect(result.current.error?.code).toBe("noSound");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("refuses an empty recording", async () => {
    FakeRecorder.bytes = 0;
    const { result } = renderHook(() => useAudioRecorder());
    await record(result);

    expect(result.current.status).toBe("idle");
    expect(result.current.error?.code).toBe("noSound");
  });

  it("does not call a recording silent when the level meter could not run", async () => {
    inputPeak = 0;
    contextState = "suspended";
    const { result } = renderHook(() => useAudioRecorder());
    await record(result);

    expect(result.current.status).toBe("reviewing");
  });

  it("reports a denied microphone", async () => {
    navigator.mediaDevices.getUserMedia.mockRejectedValueOnce(
      new DOMException("", "NotAllowedError"),
    );
    const { result } = renderHook(() => useAudioRecorder());
    await start(result);

    expect(result.current.status).toBe("idle");
    expect(result.current.error?.code).toBe("micUnavailable");
  });

  it("resets the button and reports it when playback fails", async () => {
    FakeAudio.play.mockRejectedValueOnce(new DOMException("", "NotSupportedError"));
    const { result } = renderHook(() => useAudioRecorder());
    await record(result);

    await act(() => result.current.togglePlayback());

    expect(result.current.isPlaying).toBe(false);
    expect(result.current.error?.code).toBe("playbackFailed");
  });

  it("stops playback and frees the recording on re-record", async () => {
    const { result } = renderHook(() => useAudioRecorder());
    await record(result);
    await act(() => result.current.togglePlayback());
    expect(result.current.isPlaying).toBe(true);

    const player = FakeAudio.last;
    expect(player.src).toBe("blob:recording");
    act(() => result.current.retake());

    expect(player.pause).toHaveBeenCalled();
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.audioURL).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:recording");
  });

  it("releases the mic when the question closes mid-recording", async () => {
    const { result, unmount } = renderHook(() => useAudioRecorder());
    await start(result);

    unmount();

    expect(track.stop).toHaveBeenCalled();
    expect(FakeRecorder.last.state).toBe("inactive");
  });
});
