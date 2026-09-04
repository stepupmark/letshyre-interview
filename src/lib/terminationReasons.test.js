import {
  TERMINATION_REASONS,
  getTerminationCopy,
  isTerminationReason,
} from "./terminationReasons";

describe("terminationReasons", () => {
  it("recognizes every declared reason", () => {
    for (const reason of Object.values(TERMINATION_REASONS)) {
      expect(isTerminationReason(reason)).toBe(true);
    }
  });

  it("rejects prose and unknown values", () => {
    expect(isTerminationReason("3 compliance violations detected")).toBe(false);
    expect(isTerminationReason(undefined)).toBe(false);
    expect(isTerminationReason("")).toBe(false);
  });

  it("gives every reason a full set of copy keys", () => {
    for (const reason of Object.values(TERMINATION_REASONS)) {
      const copy = getTerminationCopy(reason);
      expect(copy.titleKey).toMatch(/^termination\./);
      expect(copy.descriptionKey).toMatch(/^termination\./);
      expect(copy.pillKey).toMatch(/^termination\./);
      expect(copy.imagePath).toBeTruthy();
      expect(typeof copy.punitive).toBe("boolean");
    }
  });

  it("falls back to generic copy for an unknown reason", () => {
    expect(getTerminationCopy("something_else").titleKey).toBe("termination.generic.title");
  });

  it("does not treat a timed-out session as misconduct", () => {
    expect(getTerminationCopy(TERMINATION_REASONS.TIME_EXPIRED).punitive).toBe(false);
    expect(getTerminationCopy(TERMINATION_REASONS.NETWORK_DISCONNECTS).punitive).toBe(false);
    expect(getTerminationCopy(TERMINATION_REASONS.VIOLATION_LIMIT).punitive).toBe(true);
  });
});
