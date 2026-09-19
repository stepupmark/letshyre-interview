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

const CLEAR_PHONE = { label: "cell phone", class_id: 67, confidence: 0.81, area_ratio: 0.013 };
const BLURRY_PHONE = { label: "cell phone", class_id: 67, confidence: 0.49, area_ratio: 0.036 };
const LAPTOP = {
  label: "laptop",
  class_id: 63,
  confidence: 0.85,
  area_ratio: 0.008,
  bbox: [194, 147, 239, 187],
};

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

const namesPhone = (violation) =>
  violation.label === "cell phone" || violation.labels?.includes("cell phone");

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
    replay([frame([BLURRY_PHONE]), frame(), frame([BLURRY_PHONE])]);
    const { onViolation } = start();

    await vi.advanceTimersByTimeAsync(7_000);

    expect(calls).toEqual([5_000, 6_000, 7_000]);
    expect(onViolation).toHaveBeenCalledTimes(1);
    expect(onViolation.mock.calls[0][0].key).toBe("PROHIBITED_OBJECT:cell phone");
  });

  it("returns to the normal cadence once the burst is spent", async () => {
    replay([frame([BLURRY_PHONE]), frame(), frame()]);
    start();

    await vi.advanceTimersByTimeAsync(12_000);

    expect(calls).toEqual([5_000, 6_000, 7_000, 12_000]);
  });

  it("strikes a clear phone on the one frame it was seen", async () => {
    replay([frame([CLEAR_PHONE])]);
    const { onViolation } = start();

    await vi.advanceTimersByTimeAsync(12_000);

    expect(onViolation).toHaveBeenCalledTimes(1);
    expect(onViolation.mock.calls[0][0]).toMatchObject({
      label: "cell phone",
      strikeKey: "PROHIBITED_OBJECT",
    });
  });

  it("does not strike a blurry phone seen on a single frame", async () => {
    replay([frame([BLURRY_PHONE]), frame(), frame()]);
    const { onViolation } = start();

    await vi.advanceTimersByTimeAsync(12_000);

    expect(onViolation).not.toHaveBeenCalled();
  });

  it("still takes a quick second look at a phone while a laptop never leaves view", async () => {
    const laptopOnly = Array.from({ length: 8 }, () => frame([LAPTOP]));
    replay([
      ...laptopOnly,
      frame([LAPTOP, BLURRY_PHONE]),
      frame([LAPTOP, BLURRY_PHONE]),
      ...laptopOnly,
    ]);
    const { onViolation } = start();

    await vi.advanceTimersByTimeAsync(120_000);

    const phoneSeenAt = calls[laptopOnly.length];
    expect(calls[laptopOnly.length + 1]).toBe(phoneSeenAt + 1_000);
    expect(onViolation.mock.calls.some(([violation]) => namesPhone(violation))).toBe(true);
  });

  it("counts a phone and a laptop confirmed in the same frame as one violation", async () => {
    const MOVED_LAPTOP = { ...LAPTOP, bbox: [212, 147, 257, 187] };
    replay([frame([LAPTOP, BLURRY_PHONE]), frame([MOVED_LAPTOP, BLURRY_PHONE])]);
    const { onViolation } = start();

    await vi.advanceTimersByTimeAsync(6_000);

    expect(onViolation).toHaveBeenCalledTimes(1);
    expect(onViolation.mock.calls[0][0]).toMatchObject({
      strikeKey: "PROHIBITED_OBJECT",
      titleKey: "violations.multipleDevices.title",
      descriptionKey: "violations.multipleDevices.description",
    });
    expect(onViolation.mock.calls[0][0].labels.sort()).toEqual(["cell phone", "laptop"]);
  });

  it("logs the phone still in view after its strike as held", async () => {
    replay([frame([BLURRY_PHONE]), frame([BLURRY_PHONE]), frame([BLURRY_PHONE])]);
    start();

    await vi.advanceTimersByTimeAsync(7_000);

    expect(decisions("PROHIBITED_OBJECT")).toEqual(["unconfirmed", "held"]);
  });

  it("logs a phone that returns later as a new sighting", async () => {
    replay([
      frame([BLURRY_PHONE]),
      frame([BLURRY_PHONE]),
      frame(),
      frame(),
      frame(),
      frame(),
      frame([BLURRY_PHONE]),
    ]);
    start();

    await vi.advanceTimersByTimeAsync(27_000);

    expect(calls.at(-1)).toBe(27_000);
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

  describe("multi-tiered NO_FACE escalation", () => {
    const noFace = () => ({ ...frame(), face_detected: false, face_count: 0 });

    it("grants silent grace window for brief absence under 3 seconds", async () => {
      // 5s: first absence frame (t=0 of incident)
      // 6s: second absence frame (burst 1, duration 1s < 3s grace)
      // 7s: candidate returns
      replay([noFace(), noFace(), frame()]);
      const { onViolation } = start();

      await vi.advanceTimersByTimeAsync(12_000);

      expect(onViolation).not.toHaveBeenCalled();
      expect(decisions("NO_FACE")).toContain("grace");
    });

    it("issues soft visual guidance between 3s and 7s without a punitive strike", async () => {
      // 5s: t=0
      // 6s: t=1s (grace)
      // 7s: t=2s (grace)
      // 8s: t=3s (soft guidance window triggered)
      // 9s: returns
      replay([noFace(), noFace(), noFace(), noFace(), frame()]);
      const { onViolation } = start();

      await vi.advanceTimersByTimeAsync(12_000);

      expect(onViolation).toHaveBeenCalledTimes(1);
      expect(onViolation.mock.calls[0][0]).toMatchObject({
        type: "NO_FACE",
        soft: true,
        countsAsViolation: false,
        titleKey: "violations.noFaceGuidance.title",
        descriptionKey: "violations.noFaceGuidance.description",
      });
    });

    it("admits a formal proctoring strike when absence exceeds 7 seconds", async () => {
      // Absence lasting > 7 seconds triggers formal strike admission
      const absenceFrames = Array.from({ length: 9 }, () => noFace());
      replay([...absenceFrames, frame()]);
      const { onViolation } = start();

      await vi.advanceTimersByTimeAsync(20_000);

      // Should have received soft guidance, then formal proctoring strike
      const calls = onViolation.mock.calls.map(([v]) => v);
      const formalStrike = calls.find((v) => v.type === "NO_FACE" && v.soft !== true);

      expect(formalStrike).toBeDefined();
      expect(formalStrike).toMatchObject({
        type: "NO_FACE",
        strikeKey: "NO_FACE",
      });
      expect(formalStrike.countsAsViolation).not.toBe(false);
    });

    it("resets grace period when candidate returns between separate brief look-downs", async () => {
      // Look-down 1: 2 missed frames (duration ~1s < 3s grace)
      // Return: 2 frames with face
      // Look-down 2: 2 missed frames (duration ~1s < 3s grace)
      // Return: candidate back
      replay([noFace(), noFace(), frame(), frame(), noFace(), noFace(), frame()]);
      const { onViolation } = start();

      await vi.advanceTimersByTimeAsync(20_000);

      // Neither absence exceeded 3 seconds, so no warnings or strikes should have been emitted
      expect(onViolation).not.toHaveBeenCalled();
      expect(decisions("NO_FACE")).toEqual(["unconfirmed", "grace", "unconfirmed", "grace"]);
    });
  });
});
