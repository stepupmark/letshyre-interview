import {
  END_REASONS,
  TERMINATION_REASONS,
  getTerminationCopy,
  isTerminationReason,
  toEndReason,
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

  it("gives every reason its own artwork", () => {
    const reasons = Object.values(TERMINATION_REASONS);
    const images = reasons.map((reason) => getTerminationCopy(reason).imagePath);
    expect(new Set([...images, getTerminationCopy("unknown").imagePath]).size).toBe(
      reasons.length + 1,
    );
  });

  it("does not treat a timed-out session as misconduct", () => {
    expect(getTerminationCopy(TERMINATION_REASONS.TIME_EXPIRED).punitive).toBe(false);
    expect(getTerminationCopy(TERMINATION_REASONS.NETWORK_DISCONNECTS).punitive).toBe(false);
    expect(getTerminationCopy(TERMINATION_REASONS.VIOLATION_LIMIT).punitive).toBe(true);
  });
});

describe("toEndReason", () => {
  it.each([
    [TERMINATION_REASONS.VIOLATION_LIMIT, END_REASONS.TERMINATED],
    [TERMINATION_REASONS.FACE_MISMATCH, END_REASONS.TERMINATED],
    [TERMINATION_REASONS.ELECTRON_SECURITY, END_REASONS.TERMINATED],
    [TERMINATION_REASONS.TIME_EXPIRED, END_REASONS.EXPIRED],
    [TERMINATION_REASONS.NETWORK_DISCONNECTS, END_REASONS.AUTO_SUBMITTED],
    ["Resuming expired session", END_REASONS.AUTO_SUBMITTED],
  ])("maps %s to %s", (reason, expected) => {
    expect(toEndReason(reason)).toBe(expected);
  });

  it("trusts the backend when it says the interview was terminated", () => {
    expect(toEndReason(TERMINATION_REASONS.NETWORK_DISCONNECTS, { terminated: true })).toBe(
      END_REASONS.TERMINATED,
    );
  });

  it("treats a restored session whose time ran out as expired", () => {
    expect(toEndReason("Resuming expired session", { timeUp: true })).toBe(END_REASONS.EXPIRED);
    expect(toEndReason(TERMINATION_REASONS.NETWORK_DISCONNECTS, { timeUp: true })).toBe(
      END_REASONS.AUTO_SUBMITTED,
    );
  });
});
