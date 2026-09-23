import { act, renderHook } from "@testing-library/react";
import { LOCAL_OBJECT_INTERVAL_MS, useLocalObjectWatch } from "./useLocalObjectWatch";
import { loadObjectDetector } from "@/lib/localObjectDetector";
import { subscribeToViolationLog } from "@/lib/violationLog";

vi.mock("@/lib/localObjectDetector", () => ({ loadObjectDetector: vi.fn() }));
vi.mock("@/lib/videoCapture", () => ({ isVideoReady: () => true }));

// Phone scores the worker reports for each successive frame (null = no phone);
// the last one repeats.
function detectorSeeing(scores) {
  const queue = [...scores];
  return {
    detect: vi.fn(async () => {
      const score = queue.length > 1 ? queue.shift() : queue[0];
      return { phones: score === null ? [] : [{ score }], ms: 150 };
    }),
  };
}

let events;
let stop;

beforeEach(() => {
  vi.useFakeTimers();
  events = [];
  stop = subscribeToViolationLog((event) => events.push(event));
});

afterEach(() => {
  stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function watch(detector, { isActive = true } = {}) {
  loadObjectDetector.mockReset();
  if (detector instanceof Error) loadObjectDetector.mockRejectedValue(detector);
  else loadObjectDetector.mockResolvedValue(detector);
  const onPhone = vi.fn();
  const hook = renderHook(() => useLocalObjectWatch({ current: {} }, isActive, onPhone));
  await act(async () => {});
  return { onPhone, ...hook };
}

const samples = (n) => act(async () => vi.advanceTimersByTimeAsync(LOCAL_OBJECT_INTERVAL_MS * n));

describe("useLocalObjectWatch", () => {
  it("calls for a check when a phone appears", async () => {
    const { onPhone } = await watch(detectorSeeing([null, null, 0.61, 0.734]));
    await samples(5);

    expect(onPhone).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        source: "local",
        type: "LOCAL_OBJECT",
        outcome: "changed",
        label: "cell phone",
        score: 0.73,
        category: "detection",
        counts_as_strike: false,
      }),
    );
  });

  it("ignores a phone seen on one sample only", async () => {
    const { onPhone } = await watch(detectorSeeing([null, 0.5, null, 0.5, null]));
    await samples(6);
    expect(onPhone).not.toHaveBeenCalled();
  });

  it("calls once while the phone stays, and again after it leaves and returns", async () => {
    const { onPhone } = await watch(detectorSeeing([0.5, 0.5, 0.5, 0.5, null, 0.5, 0.5]));
    await samples(4);
    expect(onPhone).toHaveBeenCalledTimes(1);

    await samples(4);
    expect(onPhone).toHaveBeenCalledTimes(2);
  });

  it("does not load or run while the interview is inactive", async () => {
    await watch(detectorSeeing([null]), { isActive: false });
    expect(loadObjectDetector).not.toHaveBeenCalled();
  });

  it("stops when it is unmounted", async () => {
    const detector = detectorSeeing([null]);
    const { unmount } = await watch(detector);
    await samples(2);
    const calls = detector.detect.mock.calls.length;

    unmount();
    await samples(5);

    expect(detector.detect).toHaveBeenCalledTimes(calls);
  });

  it("logs and stays off when the detector can't load", async () => {
    const { onPhone } = await watch(new Error("wasm blocked"));
    await samples(5);

    expect(onPhone).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "LOCAL_OBJECT",
        outcome: "unavailable",
        reason: "load_failed",
        error: "wasm blocked",
      }),
    );
  });

  it("stops after a detection error", async () => {
    const detector = { detect: vi.fn().mockRejectedValue(new Error("worker crashed")) };
    await watch(detector);
    await samples(5);

    expect(detector.detect).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual(expect.objectContaining({ reason: "detect_failed" }));
  });

  it("waits for the worker's answer before sending the next frame", async () => {
    let answer;
    const detector = { detect: vi.fn(() => new Promise((resolve) => (answer = resolve))) };
    await watch(detector);
    await samples(5);
    expect(detector.detect).toHaveBeenCalledTimes(1);

    await act(async () => answer({ phones: [], ms: 150 }));
    await samples(1);
    expect(detector.detect).toHaveBeenCalledTimes(2);
  });

  it("stops on a device too slow to keep up", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 1_100));
    const detector = detectorSeeing([null]);
    await watch(detector);
    await samples(10);

    expect(detector.detect).toHaveBeenCalledTimes(5);
    expect(events).toContainEqual(expect.objectContaining({ reason: "too_slow" }));
  });
});
