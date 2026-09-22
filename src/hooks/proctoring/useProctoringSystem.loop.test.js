import { renderHook } from "@testing-library/react";
import { detectFrame } from "@/services/proctoring.api";
import { subscribeToViolationLog } from "@/lib/violationLog";
import { useProctoringSystem } from "./useProctoringSystem";

vi.mock("@/services/proctoring.api", () => ({
  detectFrame: vi.fn(),
  submitProctoringLogs: vi.fn(),
}));

const camera = vi.hoisted(() => ({ ready: true }));
const shadowRules = vi.hoisted(() => new Set());

vi.mock("@/lib/videoCapture", () => ({
  captureSample: () => (camera.ready ? { frame: "frame", file: {}, capturedAt: Date.now() } : null),
  isVideoReady: () => camera.ready,
}));

vi.mock("@/config/interview", async (importOriginal) => ({
  ...(await importOriginal()),
  SHADOW_RULES: shadowRules,
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

function start(onViolation = vi.fn(() => "raised"), onSample = vi.fn(), video = {}) {
  renderHook(() =>
    useProctoringSystem({ current: video }, "i1", "s1", true, "token", onViolation, onSample),
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
  camera.ready = true;
  shadowRules.clear();
  shadowRules.add("gaze");
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
      restrikeAfterMs: 30_000,
      maxRestrikes: 1,
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

  it("treats a phone queued behind another strike as spent evidence", async () => {
    replay([frame([BLURRY_PHONE]), frame([BLURRY_PHONE]), frame([BLURRY_PHONE])]);
    start(vi.fn(() => "queued"));

    await vi.advanceTimersByTimeAsync(7_000);

    expect(decisions("PROHIBITED_OBJECT")).toEqual(["unconfirmed", "held"]);
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

const FAINT_PHONE = { label: "cell phone", class_id: 67, confidence: 0.25, area_ratio: 0.02 };
const FAINT_LAPTOP = { label: "laptop", class_id: 63, confidence: 0.28, area_ratio: 0.02 };
const notLooking = () => ({ ...frame(), looking_at_camera: false });

const ofType = (onViolation, type) =>
  onViolation.mock.calls.map(([violation]) => violation).filter((v) => v.type === type);

const softAware = () => vi.fn((violation) => (violation.soft ? "soft" : "raised"));

const pressKey = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));

describe("suspicion sampling", () => {
  it("samples every 2s for 20s after a phone too faint to count", async () => {
    replay([frame([FAINT_PHONE])]);
    const { onViolation } = start();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(calls).toEqual([
      5_000, 7_000, 9_000, 11_000, 13_000, 15_000, 17_000, 19_000, 21_000, 23_000, 25_000, 30_000,
    ]);
    expect(onViolation).not.toHaveBeenCalled();
  });

  it("keeps the 1s confirmation burst ahead of it", async () => {
    replay([frame([BLURRY_PHONE, FAINT_LAPTOP]), frame(), frame()]);
    start();

    await vi.advanceTimersByTimeAsync(9_000);

    expect(calls).toEqual([5_000, 6_000, 7_000, 9_000]);
  });

  it("never shortens the backoff after a failure", async () => {
    detectFrame.mockImplementation(async () => {
      calls.push(Date.now());
      if (calls.length === 1) return frame([FAINT_PHONE]);
      throw new Error("offline");
    });
    start();

    await vi.advanceTimersByTimeAsync(40_000);

    expect(calls).toEqual([5_000, 7_000, 17_000, 37_000]);
  });

  it("samples faster after a look away", async () => {
    replay([notLooking()]);
    start(softAware());

    await vi.advanceTimersByTimeAsync(7_000);

    expect(calls).toEqual([5_000, 7_000]);
  });

  it("stays on the normal cadence for a look away while the candidate is typing", async () => {
    replay([notLooking()]);
    start(softAware());

    await vi.advanceTimersByTimeAsync(4_000);
    pressKey();
    await vi.advanceTimersByTimeAsync(6_000);

    expect(calls).toEqual([5_000, 10_000]);
  });
});

describe("camera turned off", () => {
  const liveTrack = () => ({ readyState: "live", muted: false });
  const videoWith = (track) => ({ srcObject: { getVideoTracks: () => [track] } });

  it("strikes once the camera has been off for more than 10 seconds", async () => {
    const track = liveTrack();
    const { onViolation } = start(undefined, undefined, videoWith(track));

    await vi.advanceTimersByTimeAsync(3_000);
    track.readyState = "ended";
    await vi.advanceTimersByTimeAsync(11_000);
    expect(ofType(onViolation, "CAMERA_OFF")).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1_000);
    const [strike] = ofType(onViolation, "CAMERA_OFF");
    expect(strike).toMatchObject({
      strikeKey: "CAMERA_OFF",
      incident: true,
      incidentStartedAt: 4_000,
      restrikeAfterMs: 30_000,
      maxRestrikes: 1,
      titleKey: "violations.cameraOff.title",
      descriptionKey: "violations.cameraOff.description",
      imagePath: "/no-candidate.png",
      detail: { reason: "track_ended" },
    });
    expect(strike.countsAsViolation).not.toBe(false);
  });

  it("keeps one incident while it stays off and starts a new one after it comes back", async () => {
    const track = liveTrack();
    const { onViolation } = start(undefined, undefined, videoWith(track));

    await vi.advanceTimersByTimeAsync(1_000);
    track.muted = true;
    await vi.advanceTimersByTimeAsync(22_000);
    track.muted = false;
    await vi.advanceTimersByTimeAsync(2_000);
    track.muted = true;
    await vi.advanceTimersByTimeAsync(12_000);

    const starts = ofType(onViolation, "CAMERA_OFF").map((v) => v.incidentStartedAt);
    expect(starts).toEqual([2_000, 2_000, 2_000, 26_000]);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "CAMERA_OFF", outcome: "recovered" }),
    );
  });

  it("costs nothing when the camera is back within 10 seconds", async () => {
    const track = liveTrack();
    const { onViolation } = start(undefined, undefined, videoWith(track));

    await vi.advanceTimersByTimeAsync(1_000);
    track.readyState = "ended";
    await vi.advanceTimersByTimeAsync(9_000);
    track.readyState = "live";
    await vi.advanceTimersByTimeAsync(20_000);

    expect(ofType(onViolation, "CAMERA_OFF")).toHaveLength(0);
  });

  it("strikes when the video stops producing frames", async () => {
    const { onViolation } = start(undefined, undefined, videoWith(liveTrack()));

    await vi.advanceTimersByTimeAsync(2_000);
    camera.ready = false;
    await vi.advanceTimersByTimeAsync(12_000);

    expect(ofType(onViolation, "CAMERA_OFF")[0]).toMatchObject({
      detail: { reason: "no_frames" },
    });
  });

  it("never treats an AI service outage as the camera being off", async () => {
    detectFrame.mockRejectedValue(new Error("service down"));
    const { onViolation } = start(undefined, undefined, videoWith(liveTrack()));

    await vi.advanceTimersByTimeAsync(120_000);

    expect(onViolation).not.toHaveBeenCalled();
  });
});

describe("looking away", () => {
  const lapse = () => [
    notLooking(),
    notLooking(),
    notLooking(),
    ...Array.from({ length: 5 }, () => frame()),
  ];

  it("strikes a look away held for 15 seconds, once per episode", async () => {
    shadowRules.clear();
    replay(Array.from({ length: 30 }, notLooking));
    const onViolation = softAware();
    start(onViolation);

    await vi.advanceTimersByTimeAsync(19_000);
    expect(ofType(onViolation, "LOOKING_AWAY")).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(40_000);
    const strikes = ofType(onViolation, "LOOKING_AWAY");
    expect(strikes).toHaveLength(1);
    expect(strikes[0]).toMatchObject({
      strikeKey: "LOOKING_AWAY",
      incident: true,
      incidentStartedAt: 5_000,
      titleKey: "violations.lookingAway.title",
      descriptionKey: "violations.lookingAway.description",
      imagePath: "/no-candidate.png",
      detail: { reason: "held" },
    });
    expect(strikes[0].countsAsViolation).not.toBe(false);
  });

  it("strikes on the fourth separate look away within two minutes", async () => {
    shadowRules.clear();
    replay([...lapse(), ...lapse(), ...lapse()]);
    const onViolation = softAware();
    start(onViolation);

    await vi.advanceTimersByTimeAsync(55_000);
    expect(ofType(onViolation, "LOOKING_AWAY")).toHaveLength(0);

    replay(lapse());
    await vi.advanceTimersByTimeAsync(20_000);
    const strikes = ofType(onViolation, "LOOKING_AWAY");
    expect(strikes).toHaveLength(1);
    expect(strikes[0].detail.reason).toBe("repeated");
  });

  it("ignores looking down while the candidate is typing", async () => {
    shadowRules.clear();
    replay(Array.from({ length: 30 }, notLooking));
    const onViolation = softAware();
    start(onViolation);
    const typing = setInterval(pressKey, 1_000);

    await vi.advanceTimersByTimeAsync(60_000);
    clearInterval(typing);

    expect(ofType(onViolation, "LOOKING_AWAY")).toHaveLength(0);
  });

  it("only logs the strike while the gaze rule is in shadow mode", async () => {
    replay(Array.from({ length: 30 }, notLooking));
    const onViolation = softAware();
    start(onViolation);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(ofType(onViolation, "LOOKING_AWAY")).toHaveLength(0);
    expect(decisions("LOOKING_AWAY")).toEqual(["shadow"]);
    expect(ofType(onViolation, "NOT_LOOKING").length).toBeGreaterThan(0);
  });
});

describe("useProctoringSystem degraded mode", () => {
  const render = () =>
    renderHook(() =>
      useProctoringSystem({ current: {} }, "i1", "s1", true, "token", vi.fn(), vi.fn()),
    ).result;

  it("does not call a slow camera a service outage", async () => {
    camera.ready = false;
    const result = render();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(result.current.isDegraded).toBe(false);
  });

  it("degrades after three failed detection calls and recovers on the next answer", async () => {
    detectFrame.mockRejectedValue(new Error("timeout"));
    const result = render();

    await vi.advanceTimersByTimeAsync(40_000);
    expect(result.current.isDegraded).toBe(true);

    detectFrame.mockResolvedValue(frame());
    await vi.advanceTimersByTimeAsync(40_000);
    expect(result.current.isDegraded).toBe(false);
  });
});

describe("face verification pacing", () => {
  const render = (onSample = vi.fn()) => {
    const { result } = renderHook(() =>
      useProctoringSystem({ current: {} }, "i1", "s1", true, "token", vi.fn(), onSample),
    );
    return { result, onSample };
  };

  it("pulls the next frame in to 2s when verification asks", async () => {
    replay([]);
    const { result } = render();

    await vi.advanceTimersByTimeAsync(5_000);
    result.current.sampleSoon("face_mismatch");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(calls).toEqual([5_000, 7_000, 9_000, 11_000, 13_000, 15_000]);
  });

  it("does not speed detection up while it is backing off", async () => {
    detectFrame.mockImplementation(async () => {
      calls.push(Date.now());
      throw new Error("offline");
    });
    const { result } = render();

    await vi.advanceTimersByTimeAsync(5_000);
    result.current.sampleSoon("face_mismatch");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(calls).toEqual([5_000, 15_000]);
  });

  it("keeps identity checks every 5s while detection backs off", async () => {
    detectFrame.mockRejectedValue(new Error("offline"));
    const { onSample } = render();

    await vi.advanceTimersByTimeAsync(35_000);

    expect(onSample.mock.calls.map(([sample]) => sample.capturedAt)).toEqual([
      5_000, 10_000, 15_000, 20_000, 25_000, 30_000, 35_000,
    ]);
    expect(onSample.mock.calls.every(([sample]) => sample.faceCount === undefined)).toBe(true);
  });
});
