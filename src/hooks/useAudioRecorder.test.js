import { act, renderHook } from "@testing-library/react";
import { subscribeToViolationLog } from "@/lib/violationLog";
import {
  MUTE_GRACE_MS,
  SILENCE_PEAK,
  WARMUP_MS,
  isVirtualInput,
  useAudioRecorder,
} from "./useAudioRecorder";

let recordedPeak = 0.3;
let decodeFails = false;

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

class FakeOfflineAudioContext {
  decodeAudioData = vi.fn(async () => {
    if (decodeFails) throw new DOMException("", "EncodingError");
    return {
      duration: 1,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(8).fill(recordedPeak),
    };
  });
}

class FakeAudioContext {
  static sources = [];
  state = "running";
  currentTime = 0;
  destination = {};
  resume = vi.fn(() => Promise.resolve());
  close = () => Promise.resolve();
  createMediaStreamSource = () => ({ connect: () => {} });
  createAnalyser = () => ({
    fftSize: 1024,
    getFloatTimeDomainData: (samples) => samples.fill(0.3),
  });
  createBufferSource = () => {
    const source = { connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    FakeAudioContext.sources.push(source);
    return source;
  };
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
    return FakeAudio.play().catch((err) => {
      this.paused = true;
      throw err;
    });
  }
}

function fakeTrack(label = "Mic") {
  const listeners = {};
  return {
    label,
    muted: false,
    stop: vi.fn(),
    getSettings: () => ({}),
    addEventListener: (name, fn) => (listeners[name] ??= []).push(fn),
    emit: (name) => listeners[name]?.forEach((fn) => fn()),
  };
}

const input = (deviceId, label) => ({ kind: "audioinput", deviceId, label });

let track;
let events;
let unsubscribe;

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  recordedPeak = 0.3;
  decodeFails = false;
  FakeRecorder.bytes = 5_000;
  FakeAudioContext.sources = [];
  FakeAudio.play.mockReset().mockResolvedValue(undefined);
  events = [];
  unsubscribe = subscribeToViolationLog((event) => events.push(event));

  track = fakeTrack();
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };

  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("OfflineAudioContext", FakeOfflineAudioContext);
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
  unsubscribe();
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
  await act(async () => {
    result.current.stopRecording();
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function mountWith(devices) {
  navigator.mediaDevices.enumerateDevices.mockResolvedValue(devices);
  const hook = renderHook(() => useAudioRecorder());
  await act(() => vi.advanceTimersByTimeAsync(0));
  return hook;
}

const voiceLog = (type) => events.filter((e) => e.source === "voice" && e.type === type);
const requestedDevice = () =>
  navigator.mediaDevices.getUserMedia.mock.calls.at(-1)[0].audio.deviceId?.exact;

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

  it("refuses a recording that decodes to silence", async () => {
    recordedPeak = SILENCE_PEAK / 2;
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

  it("refuses a recording the browser cannot decode", async () => {
    decodeFails = true;
    const { result } = renderHook(() => useAudioRecorder());
    await record(result);

    expect(result.current.status).toBe("idle");
    expect(result.current.error?.code).toBe("unplayable");
  });

  it("keeps the recording when no decoder is available", async () => {
    vi.stubGlobal("OfflineAudioContext", undefined);
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

  it("plays the decoded audio when the element can't load the recording", async () => {
    FakeAudio.play.mockRejectedValueOnce(new DOMException("", "NotSupportedError"));
    const { result } = renderHook(() => useAudioRecorder());
    await record(result);

    await act(() => result.current.togglePlayback());

    expect(result.current.isPlaying).toBe(true);
    expect(result.current.error).toBeNull();
    expect(FakeAudioContext.sources.at(-1).start).toHaveBeenCalledWith(0, 0);

    await act(() => result.current.togglePlayback());
    expect(FakeAudioContext.sources.at(-1).stop).toHaveBeenCalled();
    expect(result.current.isPlaying).toBe(false);
  });

  it("tells the candidate when playback was blocked", async () => {
    FakeAudio.play.mockRejectedValueOnce(new DOMException("", "NotAllowedError"));
    const { result } = renderHook(() => useAudioRecorder());
    await record(result);

    await act(() => result.current.togglePlayback());

    expect(result.current.isPlaying).toBe(false);
    expect(result.current.error?.code).toBe("playbackBlocked");
  });

  it("reports a failure when there is nothing decoded to fall back to", async () => {
    vi.stubGlobal("OfflineAudioContext", undefined);
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

  it("logs which microphone each answer was recorded on", async () => {
    track = fakeTrack("Headset Mic");
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    navigator.mediaDevices.getUserMedia.mockResolvedValue(stream);
    const { result } = renderHook(() => useAudioRecorder());
    await record(result);

    expect(voiceLog("RECORDING")).toEqual([
      expect.objectContaining({ device: "Headset Mic", seconds: 1 }),
    ]);
  });
});

describe("useAudioRecorder microphone choice", () => {
  it("hides the duplicate communications entry and virtual devices", async () => {
    const { result } = await mountWith([
      input("default", "Default - Realtek Mic"),
      input("communications", "Communications - Realtek Mic"),
      input("realtek", "Realtek Mic"),
      input("cable", "CABLE Output (VB-Audio Virtual Cable)"),
      input("mix", "Stereo Mix (Realtek Audio)"),
    ]);

    expect(result.current.devices.map((d) => d.deviceId)).toEqual(["default", "realtek"]);
    expect(result.current.deviceId).toBe("default");
  });

  it("carries the chosen mic to the next question and logs the change", async () => {
    const devices = [input("default", "Default - Laptop Mic"), input("usb", "USB Mic")];
    const first = await mountWith(devices);
    act(() => first.result.current.selectDevice("usb"));
    first.unmount();

    const { result } = await mountWith(devices);
    await start(result);

    expect(result.current.deviceId).toBe("usb");
    expect(requestedDevice()).toBe("usb");
    expect(voiceLog("MIC_CHANGED")).toEqual([
      expect.objectContaining({ device: "USB Mic", reason: "candidate" }),
    ]);
  });

  it("falls back to another mic when the saved one is unplugged", async () => {
    sessionStorage.setItem("voice_input_device", "usb");
    const { result } = await mountWith([input("default", "Default - Laptop Mic")]);

    expect(result.current.deviceId).toBe("default");
    expect(result.current.error?.code).toBe("micSwitched");
    expect(sessionStorage.getItem("voice_input_device")).toBeNull();
  });

  it("keeps the saved mic while the list is still hidden behind permission", async () => {
    sessionStorage.setItem("voice_input_device", "usb");
    const { result } = await mountWith([{ kind: "audioinput", deviceId: "", label: "" }]);

    expect(result.current.deviceId).toBe("usb");
    expect(result.current.error).toBeNull();
  });

  it("records on the default mic when the saved one can't be opened", async () => {
    sessionStorage.setItem("voice_input_device", "usb");
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    navigator.mediaDevices.getUserMedia
      .mockRejectedValueOnce(new DOMException("", "OverconstrainedError"))
      .mockResolvedValueOnce(stream);
    const { result } = renderHook(() => useAudioRecorder());
    await start(result);

    expect(result.current.status).toBe("recording");
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenLastCalledWith({ audio: true });
  });
});

describe("useAudioRecorder input safety", () => {
  it.each(["CABLE Output (VB-Audio Virtual Cable)", "VoiceMeeter Output", "BlackHole 2ch"])(
    "treats %s as virtual",
    (label) => expect(isVirtualInput(label)).toBe(true),
  );

  it.each(["Microphone Array (Realtek(R) Audio)", "Microphone (NVIDIA Broadcast)", "AirPods"])(
    "treats %s as a real mic",
    (label) => expect(isVirtualInput(label)).toBe(false),
  );

  it("refuses to record from a virtual device", async () => {
    track = fakeTrack("CABLE Output (VB-Audio Virtual Cable)");
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    navigator.mediaDevices.getUserMedia.mockResolvedValue(stream);
    const { result } = renderHook(() => useAudioRecorder());
    await start(result);

    expect(result.current.status).toBe("idle");
    expect(result.current.error?.code).toBe("virtualMic");
    expect(track.stop).toHaveBeenCalled();
    expect(voiceLog("VIRTUAL_MIC")).toEqual([expect.objectContaining({ outcome: "blocked" })]);
  });

  it("discards the take when the mic is unplugged mid-recording", async () => {
    const { result } = renderHook(() => useAudioRecorder());
    await start(result);

    await act(async () => {
      track.emit("ended");
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.audioBlob).toBeNull();
    expect(result.current.error?.code).toBe("micDisconnected");
    expect(voiceLog("MIC_DISCONNECTED")).toHaveLength(1);
  });

  it("stops warming up when the mic is unplugged before recording starts", async () => {
    const { result } = renderHook(() => useAudioRecorder());

    await act(async () => {
      const pending = result.current.startRecording();
      await vi.advanceTimersByTimeAsync(0);
      track.emit("ended");
      await vi.advanceTimersByTimeAsync(WARMUP_MS);
      await pending;
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.error?.code).toBe("micDisconnected");
    expect(FakeRecorder.last.start).not.toHaveBeenCalled();
  });

  it("flags a mic that stays muted but ignores a brief blip", async () => {
    const { result } = renderHook(() => useAudioRecorder());
    await start(result);

    act(() => track.emit("mute"));
    await act(() => vi.advanceTimersByTimeAsync(MUTE_GRACE_MS / 2));
    act(() => track.emit("unmute"));
    await act(() => vi.advanceTimersByTimeAsync(MUTE_GRACE_MS));
    expect(result.current.inputMuted).toBe(false);

    act(() => track.emit("mute"));
    await act(() => vi.advanceTimersByTimeAsync(MUTE_GRACE_MS));
    expect(result.current.inputMuted).toBe(true);

    act(() => track.emit("unmute"));
    expect(result.current.inputMuted).toBe(false);
  });
});
