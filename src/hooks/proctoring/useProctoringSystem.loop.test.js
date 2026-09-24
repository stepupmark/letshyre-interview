import { act, renderHook } from "@testing-library/react";
import { detectFrame, submitProctoringLogs } from "@/services/proctoring.api";
import { checkSummary, resetViolationSummary, subscribeToViolationLog } from "@/lib/violationLog";
import { LOG_SEND_FALLBACK_MS, useProctoringSystem } from "./useProctoringSystem";

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

  it("gives a second person quick looks after an absence used its own", async () => {
    const noFace = { ...frame(), face_detected: false, face_count: 0 };
    const twoFaces = { ...frame(), face_count: 2 };
    replay([...Array(9).fill(noFace), twoFaces, twoFaces]);
    start();

    await vi.advanceTimersByTimeAsync(16_000);

    expect(calls.slice(-3)).toEqual([14_000, 15_000, 16_000]);
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

    expect(await onSample.mock.calls[0][0].detection).toEqual({
      faceCount: 1,
      faceConfidence: 0.64,
    });
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

const strikesOf = (onViolation, type) => ofType(onViolation, type).filter((v) => !v.soft);

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
    expect(strikesOf(onViolation, "CAMERA_OFF")).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1_000);
    const [strike] = strikesOf(onViolation, "CAMERA_OFF");
    expect(strike).toMatchObject({
      strikeKey: "CAMERA_OFF",
      incident: true,
      incidentStartedAt: 4_000,
      restrikeAfterMs: 30_000,
      maxRestrikes: 1,
      titleKey: "violations.cameraOff.title",
      descriptionKey: "violations.cameraOff.description",
      imagePath: "/camera-off.svg",
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

    const starts = strikesOf(onViolation, "CAMERA_OFF").map((v) => v.incidentStartedAt);
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

    expect(strikesOf(onViolation, "CAMERA_OFF")).toHaveLength(0);
  });

  it("hints once, a second after the camera goes off, without a strike", async () => {
    const track = liveTrack();
    const { onViolation } = start(undefined, undefined, videoWith(track));

    await vi.advanceTimersByTimeAsync(1_000);
    track.readyState = "ended";
    await vi.advanceTimersByTimeAsync(1_000);
    expect(ofType(onViolation, "CAMERA_OFF")).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1_000);
    const hints = () => ofType(onViolation, "CAMERA_OFF").filter((v) => v.soft);
    expect(hints()).toEqual([expect.objectContaining({ soft: true, countsAsViolation: false })]);
    expect(events).toContainEqual(
      expect.objectContaining({ source: "camera", type: "CAMERA_OFF", outcome: "hint" }),
    );

    await vi.advanceTimersByTimeAsync(5_000);
    expect(hints()).toHaveLength(1);

    track.readyState = "live";
    await vi.advanceTimersByTimeAsync(2_000);
    track.readyState = "ended";
    await vi.advanceTimersByTimeAsync(2_000);
    expect(hints()).toHaveLength(2);
  });

  it("strikes when the video stops producing frames", async () => {
    const { onViolation } = start(undefined, undefined, videoWith(liveTrack()));

    await vi.advanceTimersByTimeAsync(2_000);
    camera.ready = false;
    await vi.advanceTimersByTimeAsync(12_000);

    expect(strikesOf(onViolation, "CAMERA_OFF")[0]).toMatchObject({
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
      imagePath: "/looking-away.svg",
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

describe("faces seen by verification", () => {
  const verified = (faces) => vi.fn(async () => ({ faces }));
  const strikes = (onViolation, type) =>
    onViolation.mock.calls.map(([v]) => v).filter((v) => v.type === type && !v.soft);

  it("strikes several people that only verification saw", async () => {
    replay([]);
    const { onViolation } = start(undefined, verified("multiple"));

    await vi.advanceTimersByTimeAsync(6_000);

    expect(strikes(onViolation, "MULTIPLE_FACES")).toEqual([
      expect.objectContaining({ detail: expect.objectContaining({ seen_by: "verify" }) }),
    ]);
  });

  it("counts several people once when both checks see them", async () => {
    replay(Array.from({ length: 10 }, () => ({ ...frame(), face_count: 2 })));
    const { onViolation } = start(undefined, verified("multiple"));

    await vi.advanceTimersByTimeAsync(10_000);

    expect(strikes(onViolation, "MULTIPLE_FACES")).toEqual([
      expect.objectContaining({ detail: expect.objectContaining({ seen_by: "both" }) }),
    ]);
  });

  it("logs that a second person both checks saw could have been confirmed at once", async () => {
    replay(Array.from({ length: 10 }, () => ({ ...frame(), face_count: 2 })));
    const { onViolation } = start(undefined, verified("multiple"));

    await vi.advanceTimersByTimeAsync(5_000);

    expect(strikes(onViolation, "MULTIPLE_FACES")).toHaveLength(0);
    expect(decisions("MULTIPLE_FACES")).toEqual(["unconfirmed", "would_confirm_now"]);
  });

  it("does not log it for a second person only one check saw", async () => {
    replay(Array.from({ length: 10 }, () => ({ ...frame(), face_count: 2 })));
    start(undefined, verified("one"));

    await vi.advanceTimersByTimeAsync(5_000);

    expect(decisions("MULTIPLE_FACES")).toEqual(["unconfirmed"]);
  });

  it("strikes no face when verification finds none on a frame detection saw a face in", async () => {
    replay([]);
    const { onViolation } = start(undefined, verified("none"));

    await vi.advanceTimersByTimeAsync(6_000);
    expect(strikes(onViolation, "NO_FACE")).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(strikes(onViolation, "NO_FACE")).toEqual([
      expect.objectContaining({ detail: expect.objectContaining({ seen_by: "verify" }) }),
    ]);
  });

  it("counts on verification alone while detection is down, without extra detection calls", async () => {
    detectFrame.mockImplementation(async () => {
      calls.push(Date.now());
      throw new Error("offline");
    });
    const { onViolation } = start(undefined, verified("none"));

    await vi.advanceTimersByTimeAsync(20_000);

    expect(calls).toEqual([5_000, 15_000]);
    expect(strikes(onViolation, "NO_FACE")).toHaveLength(1);
  });

  it("does not let a slow answer hold detection up for more than 3 seconds", async () => {
    replay([]);
    start(
      undefined,
      vi.fn(() => new Promise(() => {})),
    );

    await vi.advanceTimersByTimeAsync(10_000);

    expect(calls).toEqual([5_000, 10_000]);
  });

  it("only logs what verification alone saw while verify_faces is muted", async () => {
    shadowRules.add("verify_faces");
    replay([]);
    const { onViolation } = start(undefined, verified("multiple"));

    await vi.advanceTimersByTimeAsync(10_000);

    expect(strikes(onViolation, "MULTIPLE_FACES")).toHaveLength(0);
    expect(decisions("MULTIPLE_FACES")).toContain("shadow");
  });
});

describe("sending the log", () => {
  const render = (props) =>
    renderHook(
      ({ isActive, logReady }) =>
        useProctoringSystem(
          { current: {} },
          "i1",
          "s1",
          isActive,
          "token",
          vi.fn(() => "raised"),
          vi.fn(),
          logReady,
        ),
      { initialProps: props },
    );

  beforeEach(() => {
    submitProctoringLogs.mockReset().mockResolvedValue({});
    replay([]);
  });

  it("waits for the submission to answer, then sends once", async () => {
    const { rerender } = render({ isActive: true, logReady: false });
    await vi.advanceTimersByTimeAsync(5_000);

    rerender({ isActive: false, logReady: false });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(submitProctoringLogs).not.toHaveBeenCalled();

    rerender({ isActive: false, logReady: true });
    await vi.advanceTimersByTimeAsync(0);
    rerender({ isActive: false, logReady: true });
    await vi.advanceTimersByTimeAsync(LOG_SEND_FALLBACK_MS);

    expect(submitProctoringLogs).toHaveBeenCalledTimes(1);
    expect(submitProctoringLogs.mock.calls[0][0].payload.records.length).toBeGreaterThan(0);
  });

  it("sends anyway if the submission never answers", async () => {
    const { rerender } = render({ isActive: true, logReady: false });
    await vi.advanceTimersByTimeAsync(5_000);
    rerender({ isActive: false, logReady: false });

    await vi.advanceTimersByTimeAsync(LOG_SEND_FALLBACK_MS - 1);
    expect(submitProctoringLogs).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(submitProctoringLogs).toHaveBeenCalledTimes(1);
  });

  it("does not send mid-interview when the connection comes back", async () => {
    render({ isActive: true, logReady: false });
    await vi.advanceTimersByTimeAsync(5_000);

    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);

    expect(submitProctoringLogs).not.toHaveBeenCalled();
  });

  it("retries a failed send when the connection comes back", async () => {
    submitProctoringLogs.mockRejectedValueOnce(new Error("offline"));
    const { rerender } = render({ isActive: true, logReady: false });
    await vi.advanceTimersByTimeAsync(5_000);
    rerender({ isActive: false, logReady: true });
    await vi.advanceTimersByTimeAsync(0);

    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);

    expect(submitProctoringLogs).toHaveBeenCalledTimes(2);
  });
});

describe("hints in the log", () => {
  it("logs the look-away hint the candidate was shown", async () => {
    replay(Array.from({ length: 10 }, notLooking));
    start(softAware());

    await vi.advanceTimersByTimeAsync(20_000);

    expect(decisions("NOT_LOOKING")).toContain("hint");
  });
});

describe("check timing", () => {
  it("keeps a 5s pace however long each answer takes", async () => {
    detectFrame.mockImplementation(async () => {
      calls.push(Date.now());
      await new Promise((resolve) => setTimeout(resolve, 800));
      return frame();
    });
    start();

    await vi.advanceTimersByTimeAsync(15_000);

    expect(calls).toEqual([5_000, 10_000, 15_000]);
  });

  it("looks again after the delay verification asked for", async () => {
    replay([]);
    const { result } = renderHook(() =>
      useProctoringSystem({ current: {} }, "i1", "s1", true, "token", vi.fn(), vi.fn()),
    );

    await vi.advanceTimersByTimeAsync(5_000);
    result.current.sampleSoon("face_recheck", 1_000);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(calls).toEqual([5_000, 6_000]);
  });
});

describe("detection and verification side by side", () => {
  const later = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

  function slowDetection(ms, result = frame) {
    detectFrame.mockImplementation(async () => {
      calls.push(Date.now());
      return later(ms, result());
    });
  }

  function render(onSample, localFacesRef) {
    const onViolation = vi.fn(() => "raised");
    const { result } = renderHook(() =>
      useProctoringSystem(
        { current: {} },
        "i1",
        "s1",
        true,
        "token",
        onViolation,
        onSample,
        true,
        localFacesRef,
      ),
    );
    return { result, onViolation };
  }

  async function frameRecords(result) {
    submitProctoringLogs.mockReset().mockResolvedValue({});
    await result.current.flush();
    return submitProctoringLogs.mock.calls[0][0].payload.records.filter((record) =>
      ["frame", "verified_frame"].includes(record.event_type),
    );
  }

  it("starts verification the moment the frame is captured", async () => {
    slowDetection(2_000);
    const askedAt = [];
    render(
      vi.fn(async () => {
        askedAt.push(Date.now());
        return { faces: "one" };
      }),
    );

    await vi.advanceTimersByTimeAsync(5_000);

    expect(calls).toEqual([5_000]);
    expect(askedAt).toEqual([5_000]);
  });

  it("merges an answer that took longer than detection, within 3s of capture", async () => {
    slowDetection(2_000);
    render(vi.fn(() => later(2_500, { faces: "multiple" })));

    await vi.advanceTimersByTimeAsync(7_500);

    expect(events.find((e) => e.type === "MULTIPLE_FACES")).toMatchObject({
      outcome: "unconfirmed",
      seen_by: "verify",
    });
  });

  it("stops waiting 3s after capture, however long detection took", async () => {
    slowDetection(2_000);
    const { result, onViolation } = render(vi.fn(() => later(3_500, { faces: "multiple" })));

    await vi.advanceTimersByTimeAsync(8_000);
    const [record] = await frameRecords(result);

    expect(record.timestamp).toBe(new Date(8_000).toISOString());
    expect(record.payload.verified_faces).toBeUndefined();
    expect(record.payload.verify_ms).toBeNull();
    expect(ofType(onViolation, "MULTIPLE_FACES")).toHaveLength(0);
  });

  it("tells verification the device sees an empty seat, without waiting on detection", async () => {
    replay(Array.from({ length: 10 }, () => ({ ...frame(), face_detected: false, face_count: 0 })));
    const onSample = vi.fn(async () => undefined);
    const { result } = render(onSample, { current: "none" });

    await vi.advanceTimersByTimeAsync(5_000);
    const [record] = await frameRecords(result);

    expect(onSample).toHaveBeenCalledWith(
      expect.objectContaining({ faceCount: 0, detection: undefined }),
    );
    expect(decisions("NO_FACE")).toEqual(["unconfirmed"]);
    expect(record.payload.local_faces).toBe("none");
  });

  it("logs verification's no face without counting it when detection and the device see one", async () => {
    replay([]);
    const { onViolation } = render(
      vi.fn(async () => ({ faces: "none" })),
      { current: "one" },
    );

    await vi.advanceTimersByTimeAsync(12_000);

    expect(decisions("NO_FACE")).toContain("outvoted");
    expect(decisions("NO_FACE")).not.toContain("unconfirmed");
    expect(onViolation).not.toHaveBeenCalled();
  });

  it("logs what triggered each check and how long each service took", async () => {
    slowDetection(300);
    const onSample = vi.fn(() => later(400, { faces: "one", verifyMs: 380 }));
    const { result } = render(onSample, { current: "one" });

    await vi.advanceTimersByTimeAsync(10_500);
    const records = await frameRecords(result);

    expect(records.map((record) => record.payload)).toEqual([
      expect.objectContaining({
        trigger: "scheduled",
        captured_at: new Date(5_000).toISOString(),
        detect_ms: 300,
        verify_ms: 380,
        local_faces: "one",
      }),
      expect.objectContaining({
        trigger: "scheduled",
        captured_at: new Date(10_000).toISOString(),
      }),
    ]);
  });

  it("names the burst, the suspicion pace and the request behind a check", async () => {
    replay([frame([BLURRY_PHONE]), frame(), frame(), frame([FAINT_PHONE])]);
    const { result } = render(vi.fn());

    await vi.advanceTimersByTimeAsync(12_000);
    result.current.sampleSoon("face_mismatch", 500);
    await vi.advanceTimersByTimeAsync(2_500);
    const records = await frameRecords(result);

    expect(records.map((record) => record.payload.trigger)).toEqual([
      "scheduled",
      "burst",
      "burst",
      "scheduled",
      "face_mismatch",
      "suspicion",
    ]);
  });

  it("marks the first answered check", async () => {
    replay([]);
    const { result } = render(vi.fn());

    await act(() => vi.advanceTimersByTimeAsync(4_900));
    expect(result.current.hasChecked).toBe(false);

    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(result.current.hasChecked).toBe(true);
  });

  it("feeds the check summary, counting a detection outage as unwatched time", async () => {
    resetViolationSummary();
    detectFrame.mockImplementation(async () => {
      calls.push(Date.now());
      if (calls.length === 2) throw new Error("offline");
      return later(200, frame());
    });
    render(vi.fn(async () => ({ faces: "one", verifyMs: 150 })));

    await vi.advanceTimersByTimeAsync(21_000);

    // The identity-only check at 15s is a check too.
    expect(calls).toEqual([5_000, 10_000, 20_000]);
    expect(checkSummary()).toMatchObject({
      count: 4,
      detect_ms: { p50: 200 },
      verify_ms: { p50: 150 },
      unobserved_ms: 15_000,
    });
  });
});

describe("quick looks", () => {
  it("takes up a recheck asked for while the frame is still being checked", async () => {
    replay([]);
    let hook;
    const onSample = vi.fn(async (sample) => {
      await sample.detection;
      if (onSample.mock.calls.length === 1) hook.result.current.sampleSoon("face_recheck", 1_000);
      return { faces: "one" };
    });
    hook = renderHook(() =>
      useProctoringSystem({ current: {} }, "i1", "s1", true, "token", vi.fn(), onSample),
    );

    await vi.advanceTimersByTimeAsync(6_000);

    expect(calls).toEqual([5_000, 6_000]);
  });

  it("still backs off after a failure when a recheck was asked for mid-check", async () => {
    let hook;
    detectFrame.mockImplementation(async () => {
      calls.push(Date.now());
      throw new Error("offline");
    });
    const onSample = vi.fn(async () => {
      hook.result.current.sampleSoon("face_recheck", 1_000);
    });
    hook = renderHook(() =>
      useProctoringSystem({ current: {} }, "i1", "s1", true, "token", vi.fn(), onSample),
    );

    await vi.advanceTimersByTimeAsync(14_000);

    expect(calls).toEqual([5_000]);
  });

  describe("from the device", () => {
    const render = () =>
      renderHook(() =>
        useProctoringSystem({ current: {} }, "i1", "s1", true, "token", vi.fn(), vi.fn()),
      ).result;

    it("looks at once, but only once per 1.5s", async () => {
      replay([]);
      const result = render();

      await vi.advanceTimersByTimeAsync(5_500);
      result.current.sampleSoon("local_face_change", 0);
      await vi.advanceTimersByTimeAsync(100);
      result.current.sampleSoon("local_face_change", 0);
      await vi.advanceTimersByTimeAsync(2_000);

      expect(calls).toEqual([5_000, 5_500, 7_000]);
    });

    it("moves a change seen mid-check to the end of the gap", async () => {
      detectFrame.mockImplementation(async () => {
        calls.push(Date.now());
        await new Promise((resolve) => setTimeout(resolve, 500));
        return frame();
      });
      const result = render();

      await vi.advanceTimersByTimeAsync(5_000);
      result.current.sampleSoon("local_face_change", 0);
      await vi.advanceTimersByTimeAsync(800);
      result.current.sampleSoon("local_object_change", 0);
      await vi.advanceTimersByTimeAsync(2_000);

      expect(calls).toEqual([5_000, 5_750, 7_250]);
    });

    it("does not switch to the faster pace", async () => {
      replay([]);
      const result = render();

      await vi.advanceTimersByTimeAsync(5_500);
      result.current.sampleSoon("local_face_change", 0);
      await vi.advanceTimersByTimeAsync(10_000);

      expect(calls).toEqual([5_000, 5_500, 10_500, 15_500]);
    });
  });
});
