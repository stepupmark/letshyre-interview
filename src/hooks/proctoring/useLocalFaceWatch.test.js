import { act, renderHook } from "@testing-library/react";
import { LOCAL_FACE_INTERVAL_MS, useLocalFaceWatch } from "./useLocalFaceWatch";
import { loadFaceDetector } from "@/lib/localFaceDetector";
import { subscribeToViolationLog } from "@/lib/violationLog";

vi.mock("@/lib/localFaceDetector", () => ({ loadFaceDetector: vi.fn() }));
vi.mock("@/lib/videoCapture", () => ({ isVideoReady: () => true }));

// Faces the detector reports on each successive call; the last one repeats.
function detectorSeeing(counts) {
  const queue = [...counts];
  return {
    detectForVideo: vi.fn(() => {
      const count = queue.length > 1 ? queue.shift() : queue[0];
      return { detections: Array.from({ length: count }, () => ({})) };
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
  loadFaceDetector.mockReset();
  if (detector instanceof Error) loadFaceDetector.mockRejectedValue(detector);
  else loadFaceDetector.mockResolvedValue(detector);
  const onChange = vi.fn();
  const hook = renderHook(() => useLocalFaceWatch({ current: {} }, isActive, onChange));
  await act(async () => {});
  return { onChange, ...hook };
}

const samples = (n) => act(async () => vi.advanceTimersByTimeAsync(LOCAL_FACE_INTERVAL_MS * n));

describe("useLocalFaceWatch", () => {
  it("says nothing about the count it starts with", async () => {
    const { onChange } = await watch(detectorSeeing([1]));
    await samples(10);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("calls for a check when the face leaves", async () => {
    const { onChange } = await watch(detectorSeeing([1, 1, 0, 0, 0]));
    await samples(6);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("none", "one");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "LOCAL_FACE",
        outcome: "changed",
        faces: "none",
        previous: "one",
        category: "detection",
      }),
    );
  });

  it("calls for a check when a second person arrives", async () => {
    const { onChange } = await watch(detectorSeeing([1, 1, 3, 3]));
    await samples(5);
    expect(onChange).toHaveBeenCalledWith("multiple", "one");
  });

  it("ignores a count that doesn't hold for two samples", async () => {
    const { onChange } = await watch(detectorSeeing([1, 1, 0, 1, 1]));
    await samples(6);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("exposes the latest stable count", async () => {
    const { result } = await watch(detectorSeeing([1, 1, 3, 3]));
    await samples(1);
    expect(result.current.current).toBe("one");
    await samples(2);
    expect(result.current.current).toBe("multiple");
  });

  it("exposes no count once it stops", async () => {
    const detector = detectorSeeing([1, 1]);
    const { result } = await watch(detector);
    await samples(1);
    expect(result.current.current).toBe("one");

    detector.detectForVideo.mockImplementation(() => {
      throw new Error("bad frame");
    });
    await samples(1);
    expect(result.current.current).toBeNull();
  });

  it("does not load or run while the interview is inactive", async () => {
    await watch(detectorSeeing([1]), { isActive: false });
    expect(loadFaceDetector).not.toHaveBeenCalled();
  });

  it("stops when it is unmounted", async () => {
    const detector = detectorSeeing([1]);
    const { unmount } = await watch(detector);
    await samples(2);
    const calls = detector.detectForVideo.mock.calls.length;

    unmount();
    await samples(5);

    expect(detector.detectForVideo).toHaveBeenCalledTimes(calls);
  });

  it("logs and stays off when the detector can't load", async () => {
    const { onChange } = await watch(new Error("wasm blocked"));
    await samples(5);

    expect(onChange).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        outcome: "unavailable",
        reason: "load_failed",
        error: "wasm blocked",
      }),
    );
  });

  it("stops after a detection error", async () => {
    const detector = {
      detectForVideo: vi.fn(() => {
        throw new Error("bad frame");
      }),
    };
    await watch(detector);
    await samples(5);

    expect(detector.detectForVideo).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual(expect.objectContaining({ reason: "detect_failed" }));
  });

  it("stops on a device too slow to keep up", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 200));
    const detector = detectorSeeing([1]);
    await watch(detector);
    await samples(10);

    expect(detector.detectForVideo).toHaveBeenCalledTimes(5);
    expect(events).toContainEqual(expect.objectContaining({ reason: "too_slow" }));
  });
});
