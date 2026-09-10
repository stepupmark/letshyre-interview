import frames from "./__fixtures__/detectionLog.json";
import { applyBaselineRules, detectViolation, findProhibitedObjects } from "./useProctoringSystem";
import { createBaselineTracker } from "@/lib/baselineTracker";
import { createViolationStabilizer } from "@/lib/violationStabilizer";

/**
 * Replays a real session that produced no warnings at all despite a phone being
 * on camera. The two laptops in it are fixed background objects, so they must
 * stay warnings; the phone was brought into frame, so it must strike.
 */

const TICK_MS = 5_000;

function frameResult(frame) {
  return {
    success: true,
    face_detected: true,
    face_count: 1,
    looking_at_camera: true,
    eyes_open: true,
    objects_detected: frame.objects_detected,
  };
}

function replay(sequence) {
  const tracker = createBaselineTracker();
  const stabilizer = createViolationStabilizer();
  tracker.start(0);

  const outcomes = [];
  for (const { frame, at } of sequence) {
    const result = frameResult(frame);
    const classified = applyBaselineRules(tracker.classify(findProhibitedObjects(result), at));
    const detected = detectViolation(result, classified);
    const confirmed = stabilizer.push(detected);
    if (confirmed) stabilizer.commit(confirmed.key ?? confirmed.type);
    outcomes.push({ at, detected, confirmed });
  }
  return outcomes;
}

const atFiveSeconds = frames.map((frame, i) => ({ frame, at: i * TICK_MS }));

describe("detection log regression", () => {
  it("never strikes the two laptops that were there the whole time", () => {
    const strikes = replay(atFiveSeconds).filter(
      (o) => o.confirmed?.label === "laptop" && o.confirmed.countsAsViolation !== false,
    );
    expect(strikes).toHaveLength(0);
  });

  it("treats those laptops as environment rather than ignoring them", () => {
    const warnings = replay(atFiveSeconds).filter(
      (o) => o.detected?.type === "PROHIBITED_OBJECT" && o.detected.countsAsViolation === false,
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].detected.label).toBe("laptop");
    expect(warnings[0].detected.countsAsViolation).toBe(false);
  });

  it("sees the phone as introduced, not part of the room", () => {
    const phoneTicks = replay(atFiveSeconds).filter((o) => o.detected?.label === "cell phone");
    expect(phoneTicks).toHaveLength(1);
    expect(phoneTicks[0].detected.type).toBe("PROHIBITED_OBJECT");
  });

  it("cannot confirm the phone from the single frame a 5s cadence caught", () => {
    const confirmed = replay(atFiveSeconds).filter((o) => o.confirmed?.label === "cell phone");
    expect(confirmed).toHaveLength(0);
  });

  it("confirms the phone once burst sampling supplies a second look", () => {
    const phoneIndex = frames.findIndex((f) =>
      f.objects_detected.some((o) => o.label === "cell phone"),
    );
    const withBurst = [];
    frames.forEach((frame, i) => {
      withBurst.push({ frame, at: i * TICK_MS });
      if (i === phoneIndex) {
        withBurst.push({ frame, at: i * TICK_MS + 1_000 });
        withBurst.push({ frame, at: i * TICK_MS + 2_000 });
      }
    });

    const confirmed = replay(withBurst).filter((o) => o.confirmed?.label === "cell phone");
    expect(confirmed.length).toBeGreaterThan(0);
    expect(confirmed[0].confirmed.type).toBe("PROHIBITED_OBJECT");
    expect(confirmed[0].at).toBeLessThanOrEqual(phoneIndex * TICK_MS + 2_000);
  });
});

/**
 * A session where the phone was already in shot on the first observation. It
 * was baselined as furniture, then only reclassified once it drifted, so the
 * warning arrived six seconds and three detections late.
 */
const phoneFromFirstFrame = [
  {
    objects_detected: [
      {
        label: "cell phone",
        class_id: 67,
        confidence: 0.854,
        area_ratio: 0.0939,
        bbox: [209.4, 132.9, 326.9, 317.1],
      },
    ],
  },
  {
    objects_detected: [
      {
        label: "cell phone",
        class_id: 67,
        confidence: 0.576,
        area_ratio: 0.0924,
        bbox: [199.8, 157.1, 311.9, 347.1],
      },
    ],
  },
  {
    objects_detected: [
      {
        label: "cell phone",
        class_id: 67,
        confidence: 0.832,
        area_ratio: 0.092,
        bbox: [197.5, 159.8, 310.0, 348.1],
      },
    ],
  },
];

describe("phone present on the first observation", () => {
  const outcomes = () =>
    replay(phoneFromFirstFrame.map((frame, i) => ({ frame, at: i * TICK_MS })));

  it("never treats it as part of the room", () => {
    const states = outcomes().map((o) => o.detected?.state);
    expect(states).not.toContain("baseline");
    expect(states).not.toContain("pending");
  });

  it("strikes it from the very first frame", () => {
    expect(outcomes()[0].detected).toMatchObject({
      type: "PROHIBITED_OBJECT",
      state: "introduced",
      label: "cell phone",
    });
    expect(outcomes()[0].detected.countsAsViolation).toBeUndefined();
  });

  it("confirms by the second observation instead of the fourth", () => {
    const raisedAt = outcomes().findIndex((o) => o.confirmed);
    expect(raisedAt).toBe(1);
  });

  it("keeps one evidence window rather than splitting on the state flip", () => {
    const keys = new Set(outcomes().map((o) => o.detected?.key));
    expect(keys).toEqual(new Set(["PROHIBITED_OBJECT:cell phone"]));
  });
});
