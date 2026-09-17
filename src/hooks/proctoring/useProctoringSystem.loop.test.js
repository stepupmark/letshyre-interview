import { renderHook } from "@testing-library/react";
import { detectFrame } from "@/services/proctoring.api";
import { subscribeToViolationLog } from "@/lib/violationLog";
import { useProctoringSystem } from "./useProctoringSystem";

vi.mock("@/services/proctoring.api", () => ({
  detectFrame: vi.fn(),
  submitProctoringLogs: vi.fn(),
}));

vi.mock("@/lib/videoCapture", () => ({
  captureSample: () => ({ frame: "frame", file: {}, capturedAt: Date.now() }),
}));

const PHONE = { label: "cell phone", class_id: 67, confidence: 0.83, area_ratio: 0.068 };

const frame = (objects = [], confidenceScore = 0.9) => ({
  success: true,
  face_detected: true,
  face_count: 1,
  yolo_person_count: 0,
  looking_at_camera: true,
  eyes_open: true,
  confidence_score: confidenceScore,
  frame_quality: 0.3,
  objects_detected: objects,
});

let calls;
let events;
let unsubscribe;

function replay(responses) {
  detectFrame.mockImplementation(async () => {
    calls.push(Date.now());
    return responses.shift() ?? frame();
  });
}

function start(onViolation = vi.fn(() => "raised"), onSample = vi.fn()) {
  renderHook(() =>
    useProctoringSystem({ current: {} }, "i1", "s1", true, "token", onViolation, onSample),
  );
  return { onViolation, onSample };
}

const decisions = (type) =>
  events.filter((e) => e.type === type && e.source === "ai").map((e) => e.outcome);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  calls = [];
  events = [];
  unsubscribe = subscribeToViolationLog((event) => events.push(event));
});

afterEach(() => {
  unsubscribe();
  vi.useRealTimers();
});

describe("useProctoringSystem sampling", () => {
  it("keeps bursting through a missed frame so a held phone confirms in seconds", async () => {
    replay([frame([PHONE]), frame(), frame([PHONE])]);
    const { onViolation } = start();

    await vi.advanceTimersByTimeAsync(7_000);

    expect(calls).toEqual([5_000, 6_000, 7_000]);
    expect(onViolation).toHaveBeenCalledTimes(1);
    expect(onViolation.mock.calls[0][0].key).toBe("PROHIBITED_OBJECT:cell phone");
  });

  it("returns to the normal cadence once the burst is spent", async () => {
    replay([frame([PHONE]), frame(), frame()]);
    start();

    await vi.advanceTimersByTimeAsync(12_000);

    expect(calls).toEqual([5_000, 6_000, 7_000, 12_000]);
  });

  it("logs the phone still in view after its strike as held", async () => {
    replay([frame([PHONE]), frame([PHONE]), frame([PHONE])]);
    start();

    await vi.advanceTimersByTimeAsync(7_000);

    expect(decisions("PROHIBITED_OBJECT")).toEqual(["unconfirmed", "held"]);
  });

  it("logs a phone that returns later as a new sighting", async () => {
    replay([frame([PHONE]), frame([PHONE]), frame(), frame(), frame(), frame(), frame([PHONE])]);
    start();

    await vi.advanceTimersByTimeAsync(23_000);

    expect(calls.at(-1)).toBe(23_000);
    expect(decisions("PROHIBITED_OBJECT")).toEqual(["unconfirmed", "unconfirmed"]);
  });

  it("hands face verification the detector's face confidence", async () => {
    replay([frame([], 0.64)]);
    const { onSample } = start();

    await vi.advanceTimersByTimeAsync(5_000);

    expect(onSample).toHaveBeenCalledWith(
      expect.objectContaining({ faceCount: 1, faceConfidence: 0.64 }),
    );
  });
});
