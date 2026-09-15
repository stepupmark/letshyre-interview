import { confirmRuleFor, createViolationStabilizer } from "./violationStabilizer";

const noFace = { type: "NO_FACE" };
const phone = { type: "PROHIBITED_OBJECT" };
const notLooking = { type: "NOT_LOOKING", soft: true };

describe("createViolationStabilizer", () => {
  it("does not confirm a violation seen on a single tick", () => {
    const s = createViolationStabilizer();
    expect(s.push(noFace)).toEqual([]);
  });

  it("confirms a hard violation on the second tick", () => {
    const s = createViolationStabilizer();
    expect(s.push(noFace)).toEqual([]);
    expect(s.push(noFace)).toEqual([noFace]);
  });

  it("requires three hits for a soft violation", () => {
    const s = createViolationStabilizer();
    expect(s.push(notLooking)).toEqual([]);
    expect(s.push(notLooking)).toEqual([]);
    expect(s.push(notLooking)).toEqual([notLooking]);
  });

  it("confirms across a dropped frame instead of restarting", () => {
    const s = createViolationStabilizer();
    expect(s.push(phone)).toEqual([]);
    expect(s.push(null)).toEqual([]);
    expect(s.push(phone)).toEqual([phone]);
  });

  it("advances each type independently when they alternate", () => {
    const s = createViolationStabilizer();
    expect(s.push(noFace)).toEqual([]);
    expect(s.push(phone)).toEqual([]);
    expect(s.push(noFace)).toEqual([noFace]);
  });

  it("forgets evidence older than the window", () => {
    const s = createViolationStabilizer();
    s.push(phone);
    expect(s.push(null)).toEqual([]);
    expect(s.push(null)).toEqual([]);
    expect(s.push(phone)).toEqual([]);
  });

  it("keeps the window until the violation is committed", () => {
    const s = createViolationStabilizer();
    s.push(phone);
    expect(s.push(phone)).toEqual([phone]);
    expect(s.push(phone)).toEqual([phone]);
  });

  it("starts over once committed", () => {
    const s = createViolationStabilizer();
    s.push(phone);
    expect(s.push(phone)).toEqual([phone]);
    s.commit("PROHIBITED_OBJECT");
    expect(s.push(phone)).toEqual([]);
  });

  it("advances every violation the frame reported, not just the first", () => {
    const s = createViolationStabilizer();
    expect(s.push([noFace, phone])).toEqual([]);
    expect(s.push([noFace, phone])).toEqual([noFace, phone]);
  });

  it("does not penalise a window for a violation the same frame also reported", () => {
    const s = createViolationStabilizer();
    s.push([phone]);
    s.push([noFace]);
    expect(s.push([noFace, phone])).toEqual([noFace, phone]);
  });

  it("forgets everything on reset", () => {
    const s = createViolationStabilizer();
    s.push(noFace);
    s.reset();
    expect(s.push(noFace)).toEqual([]);
  });

  it("reports the in-progress window", () => {
    const s = createViolationStabilizer();
    expect(s.peek()).toEqual({});
    s.push(noFace);
    expect(s.peek().NO_FACE).toEqual({ hits: 1, size: 1 });
  });

  it("falls back to the default rule for an unknown type", () => {
    expect(confirmRuleFor("SOMETHING_NEW")).toEqual({ needed: 2, window: 3 });
  });
});
