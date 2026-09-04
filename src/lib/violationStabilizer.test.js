import { confirmTicksFor, createViolationStabilizer } from "./violationStabilizer";

const noFace = { type: "NO_FACE" };
const phone = { type: "PROHIBITED_OBJECT" };
const notLooking = { type: "NOT_LOOKING", soft: true };

describe("createViolationStabilizer", () => {
  it("does not confirm a violation seen on a single tick", () => {
    const s = createViolationStabilizer();
    expect(s.push(noFace)).toBeNull();
  });

  it("confirms a hard violation on the second consecutive tick", () => {
    const s = createViolationStabilizer();
    expect(s.push(noFace)).toBeNull();
    expect(s.push(noFace)).toBe(noFace);
  });

  it("requires three consecutive ticks for a soft violation", () => {
    const s = createViolationStabilizer();
    expect(s.push(notLooking)).toBeNull();
    expect(s.push(notLooking)).toBeNull();
    expect(s.push(notLooking)).toBe(notLooking);
  });

  it("breaks the streak on a clean tick", () => {
    const s = createViolationStabilizer();
    s.push(noFace);
    expect(s.push(null)).toBeNull();
    expect(s.push(noFace)).toBeNull();
  });

  it("breaks the streak when a different violation type arrives", () => {
    const s = createViolationStabilizer();
    s.push(noFace);
    expect(s.push(phone)).toBeNull();
    expect(s.push(phone)).toBe(phone);
  });

  it("requires a fresh streak after a confirmation", () => {
    const s = createViolationStabilizer();
    s.push(noFace);
    expect(s.push(noFace)).toBe(noFace);
    expect(s.push(noFace)).toBeNull();
    expect(s.push(noFace)).toBe(noFace);
  });

  it("forgets the streak on reset", () => {
    const s = createViolationStabilizer();
    s.push(noFace);
    s.reset();
    expect(s.push(noFace)).toBeNull();
  });

  it("reports the in-progress streak", () => {
    const s = createViolationStabilizer();
    expect(s.peek()).toEqual({ type: null, streak: 0 });
    s.push(noFace);
    expect(s.peek()).toEqual({ type: "NO_FACE", streak: 1 });
  });

  it("falls back to the default threshold for an unknown type", () => {
    expect(confirmTicksFor("SOMETHING_NEW")).toBe(2);
  });
});
