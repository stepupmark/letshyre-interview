import { detectViolation } from "./useProctoringSystem";

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
      objects_detected: [{ label: "laptop" }],
    });
    expect(violation.type).toBe("MULTIPLE_FACES");
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
