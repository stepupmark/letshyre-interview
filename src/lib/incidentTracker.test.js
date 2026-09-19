import { createIncidentTracker } from "./incidentTracker";

describe("createIncidentTracker", () => {
  it("starts an incident on the first sighting", () => {
    const tracker = createIncidentTracker();
    expect(tracker.startedAt("PHONE")).toBeUndefined();
    tracker.observe(["PHONE"], 1_000);
    expect(tracker.startedAt("PHONE")).toBe(1_000);
  });

  it("keeps the incident through a single missed frame", () => {
    const tracker = createIncidentTracker();
    tracker.observe(["PHONE"], 0);
    tracker.observe([], 5_000);
    tracker.observe(["PHONE"], 10_000);
    expect(tracker.startedAt("PHONE")).toBe(0);
  });

  it("keeps it through two misses that happen within seconds", () => {
    const tracker = createIncidentTracker();
    tracker.observe(["PHONE"], 0);
    tracker.observe([], 1_000);
    tracker.observe([], 2_000);
    tracker.observe(["PHONE"], 3_000);
    expect(tracker.startedAt("PHONE")).toBe(0);
  });

  it("starts a new incident once gone for two samples and six seconds", () => {
    const tracker = createIncidentTracker();
    tracker.observe(["PHONE"], 0);
    tracker.observe([], 5_000);
    tracker.observe([], 10_000);
    tracker.observe(["PHONE"], 15_000);
    expect(tracker.startedAt("PHONE")).toBe(15_000);
  });

  it("keeps the start while the object is confirmed on later frames", () => {
    const tracker = createIncidentTracker();
    tracker.observe(["PHONE"], 40_000);
    tracker.observe(["PHONE"], 41_000);
    expect(tracker.startedAt("PHONE")).toBe(40_000);
  });

  it("resets NO_FACE startedAt when candidate returns for >= 1.5s and 1 miss", () => {
    const tracker = createIncidentTracker();
    // Absence 1 starts at 0
    tracker.observe(["NO_FACE"], 0);
    expect(tracker.startedAt("NO_FACE")).toBe(0);

    // Candidate returns: face present at 2,000ms (1 miss of NO_FACE, 2000ms >= 1500ms)
    tracker.observe([], 2_000);

    // Candidate looks down again at 3,600ms (gap of 1,600ms from lastSeenAt)
    tracker.observe(["NO_FACE"], 3_600);
    expect(tracker.startedAt("NO_FACE")).toBe(3_600);
  });

  it("forgets everything on reset", () => {
    const tracker = createIncidentTracker();
    tracker.observe(["PHONE"], 0);
    tracker.reset();
    expect(tracker.startedAt("PHONE")).toBeUndefined();
  });
});
