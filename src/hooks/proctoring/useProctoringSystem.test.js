import { detectViolations, sendUnloadFlush } from "./useProctoringSystem";

const first = (result, classified) => detectViolations(result, classified)[0] ?? null;
const types = (result, classified) => detectViolations(result, classified).map((v) => v.type);

const CLEAN_RESULT = {
  success: true,
  face_detected: true,
  face_count: 1,
  objects_detected: [],
  looking_at_camera: true,
  eyes_open: true,
};

describe("detectViolations", () => {
  it("returns nothing when the API call was not successful", () => {
    expect(detectViolations({ success: false })).toEqual([]);
    expect(detectViolations(null)).toEqual([]);
    expect(detectViolations(undefined)).toEqual([]);
  });

  it("returns a NO_FACE violation when no face is detected", () => {
    const violation = first({ ...CLEAN_RESULT, face_detected: false });
    expect(violation).not.toBeNull();
    expect(violation.type).toBe("NO_FACE");
  });

  it("returns a MULTIPLE_FACES violation that counts as a strike", () => {
    const violation = first({ ...CLEAN_RESULT, face_count: 2 });
    expect(violation).not.toBeNull();
    expect(violation.type).toBe("MULTIPLE_FACES");
    expect(violation.countsAsViolation).toBeUndefined();
  });

  it("catches a second person the face model missed but YOLO counted", () => {
    const violation = first({ ...CLEAN_RESULT, yolo_person_count: 2 });
    expect(violation?.type).toBe("MULTIPLE_FACES");
  });

  it("leaves a single person alone when YOLO reports nobody", () => {
    const violation = first({ ...CLEAN_RESULT, yolo_person_count: 0 });
    expect(violation).toBeNull();
  });

  it("returns a PROHIBITED_OBJECT violation for a known prohibited object", () => {
    const violation = first({
      ...CLEAN_RESULT,
      objects_detected: [{ label: "cell phone" }],
    });
    expect(violation).not.toBeNull();
    expect(violation.type).toBe("PROHIBITED_OBJECT");
  });

  it("matches prohibited object labels case-insensitively", () => {
    const violation = first({
      ...CLEAN_RESULT,
      objects_detected: [{ label: "Cell Phone" }],
    });
    expect(violation).not.toBeNull();
    expect(violation.type).toBe("PROHIBITED_OBJECT");
  });

  it("does not flag an object that is not in the prohibited set", () => {
    const violation = first({
      ...CLEAN_RESULT,
      objects_detected: [{ label: "cup" }],
    });
    expect(violation).toBeNull();
  });

  it("returns a soft NOT_LOOKING violation when not looking at camera", () => {
    const violation = first({ ...CLEAN_RESULT, looking_at_camera: false });
    expect(violation).not.toBeNull();
    expect(violation.type).toBe("NOT_LOOKING");
    expect(violation.soft).toBe(true);
  });

  it("returns a soft EYES_CLOSED violation when eyes are closed", () => {
    const violation = first({ ...CLEAN_RESULT, eyes_open: false });
    expect(violation).not.toBeNull();
    expect(violation.type).toBe("EYES_CLOSED");
    expect(violation.soft).toBe(true);
  });

  it("returns null for a fully clean result", () => {
    expect(first(CLEAN_RESULT)).toBeNull();
  });

  it("prioritizes MULTIPLE_FACES over NO_FACE when both conditions match", () => {
    expect(types({ ...CLEAN_RESULT, face_detected: false, face_count: 2 })).toEqual([
      "MULTIPLE_FACES",
    ]);
  });

  it("prioritizes MULTIPLE_FACES over PROHIBITED_OBJECT when both conditions match", () => {
    const violation = first({
      ...CLEAN_RESULT,
      face_count: 2,
      objects_detected: [{ label: "cell phone" }],
    });
    expect(violation.type).toBe("MULTIPLE_FACES");
  });

  it("flags a laptop, which the candidate's own machine can never be", () => {
    const violation = first({
      ...CLEAN_RESULT,
      objects_detected: [{ label: "laptop", confidence: 0.89, area_ratio: 0.013 }],
    });
    expect(violation.type).toBe("PROHIBITED_OBJECT");
    expect(violation.label).toBe("laptop");
  });

  it("applies one confidence floor to every label", () => {
    const below = first({
      ...CLEAN_RESULT,
      objects_detected: [{ label: "laptop", confidence: 0.3, area_ratio: 0.013 }],
    });
    const above = first({
      ...CLEAN_RESULT,
      objects_detected: [{ label: "laptop", confidence: 0.4, area_ratio: 0.013 }],
    });
    expect(below).toBeNull();
    expect(above.type).toBe("PROHIBITED_OBJECT");
  });

  it("does not raise the floor on a murky frame", () => {
    const violation = first({
      ...CLEAN_RESULT,
      frame_quality: 0.2803687793400733,
      objects_detected: [
        {
          label: "laptop",
          class_id: 63,
          confidence: 0.401611328125,
          bbox: [0.15625, 287.9166564941406, 104.21875, 357.9166564941406],
          area_ratio: 0.0316162109375,
        },
      ],
    });
    expect(violation?.type).toBe("PROHIBITED_OBJECT");
    expect(violation.label).toBe("laptop");
  });

  it("drops a detection whose box is too small to be the real thing", () => {
    const violation = first({
      ...CLEAN_RESULT,
      objects_detected: [{ label: "cell phone", confidence: 0.9, area_ratio: 0.0001 }],
    });
    expect(violation).toBeNull();
  });

  it("ignores a bottle at any confidence", () => {
    const violation = first({
      ...CLEAN_RESULT,
      objects_detected: [{ label: "bottle", confidence: 0.99, area_ratio: 0.5 }],
    });
    expect(violation).toBeNull();
  });

  it("flags a tv, the label a second monitor usually lands on", () => {
    const violation = first({
      ...CLEAN_RESULT,
      objects_detected: [{ label: "tv", confidence: 0.8, area_ratio: 0.05 }],
    });
    expect(violation?.type).toBe("PROHIBITED_OBJECT");
    expect(violation.label).toBe("tv");
  });

  it("identifies an object by class_id when the label has been renamed", () => {
    const violation = first({
      ...CLEAN_RESULT,
      objects_detected: [
        { label: "mobile_phone", class_id: 67, confidence: 0.8, area_ratio: 0.05 },
      ],
    });
    expect(violation?.type).toBe("PROHIBITED_OBJECT");
    expect(violation.label).toBe("cell phone");
  });

  it("marks a baseline-only object as a warning rather than a strike", () => {
    const object = { label: "laptop", confidence: 0.89, area_ratio: 0.013 };
    const violation = first({ ...CLEAN_RESULT, objects_detected: [object] }, [
      { object, state: "baseline" },
    ]);
    expect(violation.type).toBe("PROHIBITED_OBJECT");
    expect(violation.state).toBe("baseline");
    expect(violation.countsAsViolation).toBe(false);
  });

  it("prefers an introduced object over a baseline one", () => {
    const environment = { label: "laptop", confidence: 0.89, area_ratio: 0.013 };
    const brought = { label: "cell phone", confidence: 0.66, area_ratio: 0.028 };
    const violation = first({ ...CLEAN_RESULT, objects_detected: [environment, brought] }, [
      { object: environment, state: "baseline" },
      { object: brought, state: "introduced" },
    ]);
    expect(violation.type).toBe("PROHIBITED_OBJECT");
    expect(violation.label).toBe("cell phone");
  });

  it("strikes a baseline object once its grace has expired", () => {
    const object = { label: "laptop", confidence: 0.89, area_ratio: 0.013 };
    const violation = first({ ...CLEAN_RESULT, objects_detected: [object] }, [
      { object, state: "expired" },
    ]);
    expect(violation.type).toBe("PROHIBITED_OBJECT");
    expect(violation.countsAsViolation).toBeUndefined();
  });

  it("ignores a prohibited object below the confidence threshold", () => {
    const violation = first({
      ...CLEAN_RESULT,
      objects_detected: [{ label: "cell phone", confidence: 0.3 }],
    });
    expect(violation).toBeNull();
  });

  it("flags a prohibited object above the confidence threshold", () => {
    const violation = first({
      ...CLEAN_RESULT,
      objects_detected: [{ label: "cell phone", confidence: 0.9 }],
    });
    expect(violation.type).toBe("PROHIBITED_OBJECT");
  });

  it("accepts a score field as the confidence source", () => {
    expect(
      first({ ...CLEAN_RESULT, objects_detected: [{ label: "book", score: 0.2 }] }),
    ).toBeNull();
    expect(first({ ...CLEAN_RESULT, objects_detected: [{ label: "book", score: 0.8 }] }).type).toBe(
      "PROHIBITED_OBJECT",
    );
  });

  it("prioritizes PROHIBITED_OBJECT over NOT_LOOKING when both conditions match", () => {
    const violation = first({
      ...CLEAN_RESULT,
      objects_detected: [{ label: "book" }],
      looking_at_camera: false,
    });
    expect(violation.type).toBe("PROHIBITED_OBJECT");
  });

  it("reports the missing face, not the phone, when no face is found", () => {
    expect(
      types({
        ...CLEAN_RESULT,
        face_detected: false,
        face_count: 0,
        frame_quality: 0.474,
        objects_detected: [
          {
            label: "cell phone",
            class_id: 67,
            confidence: 0.9468,
            area_ratio: 0.1776,
            bbox: [249.8, 205.6, 494.9, 794.2],
          },
        ],
      }),
    ).toEqual(["NO_FACE"]);
  });

  it("reports the missing face, not the laptop, when no face is found", () => {
    expect(
      types({
        ...CLEAN_RESULT,
        face_detected: false,
        face_count: 0,
        objects_detected: [{ label: "laptop", class_id: 63, confidence: 0.968, area_ratio: 0.497 }],
      }),
    ).toEqual(["NO_FACE"]);
  });

  it("reports the object once the candidate is visible again", () => {
    expect(
      types({
        ...CLEAN_RESULT,
        objects_detected: [
          { label: "cell phone", class_id: 67, confidence: 0.85, area_ratio: 0.009 },
        ],
      }),
    ).toEqual(["PROHIBITED_OBJECT"]);
  });

  it("reports an empty frame as NO_FACE", () => {
    expect(types({ ...CLEAN_RESULT, face_detected: false, face_count: 0 })).toEqual(["NO_FACE"]);
  });

  it("counts two phones as one violation carrying the count", () => {
    const violations = detectViolations({
      ...CLEAN_RESULT,
      objects_detected: [
        { label: "cell phone", class_id: 67, confidence: 0.9468, area_ratio: 0.1776 },
        { label: "cell phone", class_id: 67, confidence: 0.8984, area_ratio: 0.2086 },
      ],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].count).toBe(2);
    expect(violations[0].detection.area_ratio).toBe(0.2086);
  });

  it("never lets a shadowed label outrank a real one", () => {
    const tv = { label: "tv", confidence: 0.9, area_ratio: 0.4 };
    const phone = { label: "cell phone", confidence: 0.6, area_ratio: 0.01 };
    const violations = detectViolations({ ...CLEAN_RESULT, objects_detected: [tv, phone] }, [
      { object: tv, state: "introduced" },
      { object: phone, state: "introduced" },
    ]);
    expect(violations[0].label).toBe("cell phone");
    expect(violations[1]).toMatchObject({ label: "tv", shadow: true });
  });

  it("ranks by size and confidence rather than the order the API sent", () => {
    const small = { label: "book", confidence: 0.9, area_ratio: 0.02 };
    const big = { label: "cell phone", confidence: 0.9, area_ratio: 0.3 };
    const violations = detectViolations({ ...CLEAN_RESULT, objects_detected: [small, big] });
    expect(violations[0].label).toBe("cell phone");
  });

  it("identifies a book by its 80-class id", () => {
    const violation = first({
      ...CLEAN_RESULT,
      objects_detected: [{ label: "renamed", class_id: 73, confidence: 0.8, area_ratio: 0.05 }],
    });
    expect(violation.label).toBe("book");
  });

  it("prioritizes NOT_LOOKING over EYES_CLOSED when both conditions match", () => {
    const violation = first({
      ...CLEAN_RESULT,
      looking_at_camera: false,
      eyes_open: false,
    });
    expect(violation.type).toBe("NOT_LOOKING");
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
