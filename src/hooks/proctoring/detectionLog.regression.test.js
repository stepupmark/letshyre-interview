import frames from "./__fixtures__/detectionLog.json";
import {
  applyBaselineRules,
  BURST_TYPES,
  detectViolations,
  findProhibitedObjects,
} from "./useProctoringSystem";
import { createBaselineTracker } from "@/lib/baselineTracker";
import { createViolationStabilizer } from "@/lib/violationStabilizer";

/**
 * Replays a real session that produced no warnings at all despite a phone being
 * on camera. The two laptops in it are fixed background objects, so they warn
 * until their grace runs out; the phone was brought into frame, so it must strike.
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
    const detected = detectViolations(result, classified);
    const confirmed = stabilizer.push(detected);
    for (const violation of confirmed) stabilizer.commit(violation.key ?? violation.type);
    outcomes.push({ at, detected: detected[0] ?? null, confirmed: confirmed[0] ?? null });
  }
  return outcomes;
}

const atFiveSeconds = frames.map((frame, i) => ({ frame, at: i * TICK_MS }));

describe("detection log regression", () => {
  it("gives the laptops that were there from the start their grace, then strikes", () => {
    const strikes = replay(atFiveSeconds).filter(
      (o) => o.confirmed?.label === "laptop" && o.confirmed.countsAsViolation !== false,
    );
    expect(strikes.length).toBeGreaterThan(0);
    expect(strikes.every((o) => o.at > 30_000)).toBe(true);
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

/**
 * Verbatim responses from the live detection API. It reports no face whenever
 * an object is held up to the lens, which used to make every one of these read
 * as an empty chair, ten seconds late.
 */
const LIVE = {
  phone: {
    success: true,
    face_detected: false,
    face_count: 0,
    eyes_detected: true,
    eyes_open: true,
    looking_at_camera: true,
    confidence_score: 0,
    frame_quality: 0.4748754280116685,
    objects_detected: [
      {
        label: "cell phone",
        confidence: 0.94677734375,
        bbox: [249.765625, 205.5625, 494.859375, 794.21875],
        class_id: 67,
        area_ratio: 0.17756080627441406,
      },
    ],
    object_warning: null,
    violations: [],
    yolo_person_count: 0,
  },
  twoPhones: {
    success: true,
    face_detected: false,
    face_count: 0,
    eyes_detected: true,
    eyes_open: true,
    looking_at_camera: true,
    confidence_score: 0,
    frame_quality: 0.4748754280116685,
    objects_detected: [
      {
        label: "cell phone",
        confidence: 0.94677734375,
        bbox: [249.765625, 205.5625, 494.859375, 794.21875],
        class_id: 67,
        area_ratio: 0.17756080627441406,
      },
      {
        label: "cell phone",
        confidence: 0.8984375,
        bbox: [405.375, 306.90625, 714.4375, 855.3125],
        class_id: 67,
        area_ratio: 0.20859400431315103,
      },
    ],
    object_warning: null,
    violations: [],
    yolo_person_count: 0,
  },
  laptop: {
    success: true,
    face_detected: false,
    face_count: 0,
    eyes_detected: true,
    eyes_open: true,
    looking_at_camera: true,
    confidence_score: 0,
    frame_quality: 0.34179986248074734,
    objects_detected: [
      {
        label: "laptop",
        confidence: 0.96826171875,
        bbox: [0, 326.1484375, 735.75, 975.890625],
        class_id: 63,
        area_ratio: 0.49657606041949726,
      },
    ],
    object_warning: null,
    violations: [],
    yolo_person_count: 0,
  },
  threeFaces: {
    success: true,
    face_detected: true,
    face_count: 3,
    eyes_detected: true,
    eyes_open: true,
    looking_at_camera: true,
    confidence_score: 0.8752674460411072,
    frame_quality: 0.7048904380413202,
    objects_detected: [],
    object_warning: null,
    violations: [],
    yolo_person_count: 0,
  },
  clean: {
    success: true,
    face_detected: true,
    face_count: 1,
    eyes_detected: true,
    eyes_open: true,
    looking_at_camera: true,
    confidence_score: 0.9395976066589355,
    frame_quality: 0.7998371211850948,
    objects_detected: [],
    object_warning: null,
    violations: [],
    yolo_person_count: 0,
  },
};

// Mirrors the loop's own cadence: 5s apart, pulled to 1s for two samples once
// something worth confirming shows up.
function firstConfirmation(result, ticks = 6) {
  const tracker = createBaselineTracker();
  const stabilizer = createViolationStabilizer();
  tracker.start(0);

  let at = 0;
  let burstsLeft = 0;

  for (let i = 0; i < ticks; i++) {
    const classified = applyBaselineRules(tracker.classify(findProhibitedObjects(result), at));
    const detected = detectViolations(result, classified);
    const confirmed = stabilizer.push(detected);
    if (confirmed.length) return { at, violation: confirmed[0] };

    if (detected.some((violation) => BURST_TYPES.has(violation.type))) burstsLeft = 2;
    at += burstsLeft > 0 ? 1_000 : 5_000;
    if (burstsLeft > 0) burstsLeft -= 1;
  }

  return null;
}

describe("live API payloads", () => {
  it("raises a missing face when a phone hides it", () => {
    const { at, violation } = firstConfirmation(LIVE.phone);
    expect(violation.type).toBe("NO_FACE");
    expect(at).toBe(1_000);
  });

  it("raises a missing face when a laptop hides it", () => {
    const { at, violation } = firstConfirmation(LIVE.laptop);
    expect(violation.type).toBe("NO_FACE");
    expect(at).toBe(1_000);
  });

  it("still logs the hidden object even though it is not surfaced", () => {
    expect(findProhibitedObjects(LIVE.phone).map((o) => o.label)).toEqual(["cell phone"]);
    expect(findProhibitedObjects(LIVE.laptop).map((o) => o.label)).toEqual(["laptop"]);
  });

  it("treats two phones as one strike and records the count", () => {
    const visible = { ...LIVE.twoPhones, face_detected: true, face_count: 1 };
    const { violation } = firstConfirmation(visible);
    expect(violation.type).toBe("PROHIBITED_OBJECT");
    expect(violation.label).toBe("cell phone");
    expect(violation.count).toBe(2);
  });

  it("strikes a frame-filling laptop once the candidate is visible", () => {
    const visible = { ...LIVE.laptop, face_detected: true, face_count: 1 };
    const { at, violation } = firstConfirmation(visible);
    expect(violation.label).toBe("laptop");
    expect(violation.state).toBe("introduced");
    expect(violation.countsAsViolation).toBeUndefined();
    expect(violation.shadow).toBe(false);
    expect(at).toBe(1_000);
  });

  it("surfaces the weak background laptop that used to be filtered out", () => {
    const { violation } = firstConfirmation({
      success: true,
      face_detected: true,
      face_count: 1,
      eyes_detected: true,
      eyes_open: true,
      looking_at_camera: true,
      confidence_score: 0.7968570590019226,
      frame_quality: 0.2803687793400733,
      objects_detected: [
        {
          label: "laptop",
          confidence: 0.401611328125,
          bbox: [0.15625, 287.9166564941406, 104.21875, 357.9166564941406],
          class_id: 63,
          area_ratio: 0.0316162109375,
        },
      ],
      object_warning: null,
      violations: [],
      yolo_person_count: 0,
    });
    expect(violation.type).toBe("PROHIBITED_OBJECT");
    expect(violation.label).toBe("laptop");
  });

  it("raises three faces within a second", () => {
    const { at, violation } = firstConfirmation(LIVE.threeFaces);
    expect(violation.type).toBe("MULTIPLE_FACES");
    expect(at).toBe(1_000);
  });

  it("leaves a clean frame alone", () => {
    expect(firstConfirmation(LIVE.clean)).toBeNull();
    expect(detectViolations(LIVE.clean)).toEqual([]);
  });
});
