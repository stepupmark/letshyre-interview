import { confidenceFloorFor, detectViolation, sendUnloadFlush } from "./useProctoringSystem";

const CLEAN_RESULT = {
  success: true,
  face_detected: true,
  face_count: 1,
  objects_detected: [],
  looking_at_camera: true,
  eyes_open: true,
};

describe("detectViolation", () => {
  it("returns null when the API call was not successful", () => {
    expect(detectViolation({ success: false })).toBeNull();
    expect(detectViolation(null)).toBeNull();
    expect(detectViolation(undefined)).toBeNull();
  });

  it("returns a NO_FACE violation when no face is detected", () => {
    const violation = detectViolation({ ...CLEAN_RESULT, face_detected: false });
    expect(violation).not.toBeNull();
    expect(violation.type).toBe("NO_FACE");
  });

  it("returns a MULTIPLE_FACES violation that does not count as a strike", () => {
    const violation = detectViolation({ ...CLEAN_RESULT, face_count: 2 });
    expect(violation).not.toBeNull();
    expect(violation.type).toBe("MULTIPLE_FACES");
    expect(violation.countsAsViolation).toBe(false);
  });

  it("returns a PROHIBITED_OBJECT violation for a known prohibited object", () => {
    const violation = detectViolation({
      ...CLEAN_RESULT,
      objects_detected: [{ label: "cell phone" }],
    });
    expect(violation).not.toBeNull();
    expect(violation.type).toBe("PROHIBITED_OBJECT");
  });

  it("matches prohibited object labels case-insensitively", () => {
    const violation = detectViolation({
      ...CLEAN_RESULT,
      objects_detected: [{ label: "Cell Phone" }],
    });
    expect(violation).not.toBeNull();
    expect(violation.type).toBe("PROHIBITED_OBJECT");
  });

  it("does not flag an object that is not in the prohibited set", () => {
    const violation = detectViolation({
      ...CLEAN_RESULT,
      objects_detected: [{ label: "cup" }],
    });
    expect(violation).toBeNull();
  });

  it("returns a soft NOT_LOOKING violation when not looking at camera", () => {
    const violation = detectViolation({ ...CLEAN_RESULT, looking_at_camera: false });
    expect(violation).not.toBeNull();
    expect(violation.type).toBe("NOT_LOOKING");
    expect(violation.soft).toBe(true);
  });

  it("returns a soft EYES_CLOSED violation when eyes are closed", () => {
    const violation = detectViolation({ ...CLEAN_RESULT, eyes_open: false });
    expect(violation).not.toBeNull();
    expect(violation.type).toBe("EYES_CLOSED");
    expect(violation.soft).toBe(true);
  });

  it("returns null for a fully clean result", () => {
    expect(detectViolation(CLEAN_RESULT)).toBeNull();
  });

  it("prioritizes NO_FACE over MULTIPLE_FACES when both conditions match", () => {
    const violation = detectViolation({
      ...CLEAN_RESULT,
      face_detected: false,
      face_count: 2,
    });
    expect(violation.type).toBe("NO_FACE");
  });

  it("prioritizes MULTIPLE_FACES over PROHIBITED_OBJECT when both conditions match", () => {
    const violation = detectViolation({
      ...CLEAN_RESULT,
      face_count: 2,
      objects_detected: [{ label: "cell phone" }],
    });
    expect(violation.type).toBe("MULTIPLE_FACES");
  });

  it("flags a laptop, which the candidate's own machine can never be", () => {
    const violation = detectViolation({
      ...CLEAN_RESULT,
      objects_detected: [{ label: "laptop", confidence: 0.89, area_ratio: 0.013 }],
    });
    expect(violation.type).toBe("PROHIBITED_OBJECT");
    expect(violation.label).toBe("laptop");
  });

  it("applies each label's own confidence floor", () => {
    const below = detectViolation({
      ...CLEAN_RESULT,
      objects_detected: [{ label: "laptop", confidence: 0.55, area_ratio: 0.013 }],
    });
    const above = detectViolation({
      ...CLEAN_RESULT,
      objects_detected: [{ label: "cell phone", confidence: 0.55, area_ratio: 0.013 }],
    });
    expect(below).toBeNull();
    expect(above.type).toBe("PROHIBITED_OBJECT");
  });

  it("drops a detection whose box is too small to be the real thing", () => {
    const violation = detectViolation({
      ...CLEAN_RESULT,
      objects_detected: [{ label: "cell phone", confidence: 0.9, area_ratio: 0.0001 }],
    });
    expect(violation).toBeNull();
  });

  it("ignores a bottle at any confidence", () => {
    const violation = detectViolation({
      ...CLEAN_RESULT,
      objects_detected: [{ label: "bottle", confidence: 0.99, area_ratio: 0.5 }],
    });
    expect(violation).toBeNull();
  });

  it("marks a baseline-only object as a warning rather than a strike", () => {
    const object = { label: "laptop", confidence: 0.89, area_ratio: 0.013 };
    const violation = detectViolation({ ...CLEAN_RESULT, objects_detected: [object] }, [
      { object, state: "baseline" },
    ]);
    expect(violation.type).toBe("PROHIBITED_OBJECT_BASELINE");
    expect(violation.countsAsViolation).toBe(false);
  });

  it("prefers an introduced object over a baseline one", () => {
    const environment = { label: "laptop", confidence: 0.89, area_ratio: 0.013 };
    const brought = { label: "cell phone", confidence: 0.66, area_ratio: 0.028 };
    const violation = detectViolation(
      { ...CLEAN_RESULT, objects_detected: [environment, brought] },
      [
        { object: environment, state: "baseline" },
        { object: brought, state: "introduced" },
      ],
    );
    expect(violation.type).toBe("PROHIBITED_OBJECT");
    expect(violation.label).toBe("cell phone");
  });

  it("strikes a baseline object once its grace has expired", () => {
    const object = { label: "laptop", confidence: 0.89, area_ratio: 0.013 };
    const violation = detectViolation({ ...CLEAN_RESULT, objects_detected: [object] }, [
      { object, state: "expired" },
    ]);
    expect(violation.type).toBe("PROHIBITED_OBJECT");
    expect(violation.countsAsViolation).toBeUndefined();
  });

  it("ignores a prohibited object below the confidence threshold", () => {
    const violation = detectViolation({
      ...CLEAN_RESULT,
      objects_detected: [{ label: "cell phone", confidence: 0.3 }],
    });
    expect(violation).toBeNull();
  });

  it("flags a prohibited object above the confidence threshold", () => {
    const violation = detectViolation({
      ...CLEAN_RESULT,
      objects_detected: [{ label: "cell phone", confidence: 0.9 }],
    });
    expect(violation.type).toBe("PROHIBITED_OBJECT");
  });

  it("accepts a score field as the confidence source", () => {
    expect(
      detectViolation({ ...CLEAN_RESULT, objects_detected: [{ label: "book", score: 0.2 }] }),
    ).toBeNull();
    expect(
      detectViolation({ ...CLEAN_RESULT, objects_detected: [{ label: "book", score: 0.8 }] }).type,
    ).toBe("PROHIBITED_OBJECT");
  });

  it("prioritizes PROHIBITED_OBJECT over NOT_LOOKING when both conditions match", () => {
    const violation = detectViolation({
      ...CLEAN_RESULT,
      objects_detected: [{ label: "book" }],
      looking_at_camera: false,
    });
    expect(violation.type).toBe("PROHIBITED_OBJECT");
  });

  it("prioritizes NOT_LOOKING over EYES_CLOSED when both conditions match", () => {
    const violation = detectViolation({
      ...CLEAN_RESULT,
      looking_at_camera: false,
      eyes_open: false,
    });
    expect(violation.type).toBe("NOT_LOOKING");
  });
});

describe("confidenceFloorFor", () => {
  const rule = { minConfidence: 0.5, minAreaRatio: 0.004 };

  it("leaves the floor alone on a clean frame", () => {
    expect(confidenceFloorFor(rule, { area_ratio: 0.01 }, 0.79)).toBe(0.5);
  });

  it("raises the floor as frame quality drops", () => {
    expect(confidenceFloorFor(rule, { area_ratio: 0.01 }, 0.29)).toBeCloseTo(0.563, 3);
  });

  it("waives the penalty for a box big enough to be unambiguous", () => {
    expect(confidenceFloorFor(rule, { area_ratio: 0.13 }, 0.29)).toBe(0.5);
  });

  it("leaves the floor alone when quality is not reported", () => {
    expect(confidenceFloorFor(rule, { area_ratio: 0.01 }, undefined)).toBe(0.5);
  });

  it("keeps a marginal detection on a murky frame out", () => {
    const floor = confidenceFloorFor(rule, { area_ratio: 0.01 }, 0.296);
    expect(0.502).toBeLessThan(floor);
  });
});

describe("sendUnloadFlush", () => {
  const url = "https://api.test/proctoring/log/";

  const payloadWith = (n) => ({
    interview_id: "i1",
    session_id: "s1",
    source: "cv_detect",
    event_type: "batch_proctoring_logs",
    payload: {
      total_records: n,
      records: Array.from({ length: n }, (_, i) => ({
        timestamp: new Date().toISOString(),
        payload: { i, filler: "x".repeat(200) },
      })),
    },
  });

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true })),
    );
    sessionStorage.clear();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("attaches the bearer token sendBeacon cannot carry", () => {
    sessionStorage.setItem("ac", "tok123");
    sendUnloadFlush(url, payloadWith(1));

    const [, init] = fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer tok123");
    expect(init.keepalive).toBe(true);
  });

  it("omits the header when there is no token rather than sending a bad one", () => {
    sendUnloadFlush(url, payloadWith(1));
    expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it("sends a small payload untrimmed", () => {
    sendUnloadFlush(url, payloadWith(3));
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.payload.records).toHaveLength(3);
    expect(body.payload.truncated).toBeUndefined();
  });

  it("drops the oldest records instead of the whole batch when oversized", () => {
    const original = payloadWith(2000);
    sendUnloadFlush(url, original);

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.payload.truncated).toBe(true);
    expect(body.payload.records.length).toBeGreaterThan(0);
    expect(body.payload.records.length).toBeLessThan(2000);
    expect(fetch.mock.calls[0][1].body.length).toBeLessThanOrEqual(60_000);

    // the tail is what survives
    const lastKept = body.payload.records.at(-1).payload.i;
    expect(lastKept).toBe(1999);
  });
});
