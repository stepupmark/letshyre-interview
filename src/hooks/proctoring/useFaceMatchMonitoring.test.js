import { act, renderHook, waitFor } from "@testing-library/react";
import { classifyVerification, useFaceMatchMonitoring } from "./useFaceMatchMonitoring";
import { RESEED_AFTER_GAP_MS } from "./useProctoringSystem";
import { TERMINATION_REASONS } from "@/lib/terminationReasons";
import { subscribeToViolationLog } from "@/lib/violationLog";

const mutateAsync = vi.fn();

vi.mock("@mutations/useContinuousVerifyMutation", () => ({
  useContinuousVerifyMutation: () => ({ mutateAsync: (...args) => mutateAsync(...args) }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// The shapes the continuous-verify endpoint actually returns.
const MATCH = {
  success: true,
  same_person: true,
  confidence: 0.682546079158783,
  violation: null,
  total_violations: 0,
  error: null,
};
const MISMATCH = {
  success: true,
  same_person: false,
  confidence: 0.21,
  violation: null,
  total_violations: 0,
  error: null,
};
// What the endpoint actually sends: the identity verdict lands in both fields.
const LIVE_MISMATCH = {
  success: true,
  same_person: false,
  confidence: 0.07679013907909393,
  violation: "FACE_MISMATCH",
  total_violations: 2,
  error: null,
};
const LIVE_MATCH = {
  success: true,
  same_person: true,
  confidence: 1,
  violation: null,
  total_violations: 0,
  error: null,
};
const NO_FACE = {
  success: false,
  same_person: false,
  confidence: null,
  violation: "NO_FACE",
  total_violations: 2,
  error: null,
};
const MULTIPLE_FACES = { ...NO_FACE, violation: "MULTIPLE_FACES", total_violations: 10 };
const INVALID_SESSION = {
  success: false,
  same_person: null,
  confidence: null,
  violation: null,
  total_violations: null,
  error: "SESSION_NOT_FOUND",
};

// Nothing says why the call failed, so same_person is a default, not a verdict.
const UNEXPLAINED_FAILURE = {
  success: false,
  same_person: false,
  confidence: 0.2,
  violation: null,
  error: null,
};

const SAMPLE = { file: new File(["x"], "frame.jpg"), intervalMs: 5000 };
const BACKED_OFF = 40000;

function setup(options = {}) {
  const autoSubmit = vi.fn();
  const onViolation = vi.fn();

  const { result } = renderHook(() =>
    useFaceMatchMonitoring({ sessionId: "s1", autoSubmit, onViolation, ...options }),
  );

  let capturedAt = 0;

  const sample = async (response, times = 1, intervalMs = 5000) => {
    for (let i = 0; i < times; i += 1) {
      capturedAt += intervalMs;
      mutateAsync.mockResolvedValueOnce(response);
      await act(async () => {
        await result.current.verifySample({ ...SAMPLE, intervalMs, capturedAt });
      });
    }
  };

  const failSample = async (times = 1) => {
    for (let i = 0; i < times; i += 1) {
      capturedAt += 5000;
      mutateAsync.mockRejectedValueOnce(new Error("network"));
      await act(async () => {
        await result.current.verifySample({ ...SAMPLE, capturedAt });
      });
    }
  };

  const gap = (ms) => {
    capturedAt += ms;
  };

  return { autoSubmit, onViolation, sample, failSample, gap, result };
}

describe("classifyVerification", () => {
  it("reads each response shape for what it is", () => {
    expect(classifyVerification(MATCH)).toMatchObject({ verdict: "match" });
    expect(classifyVerification(MISMATCH)).toMatchObject({ verdict: "mismatch" });
    expect(classifyVerification(NO_FACE)).toMatchObject({
      verdict: "condition",
      reason: "NO_FACE",
    });
    expect(classifyVerification(MULTIPLE_FACES)).toMatchObject({
      verdict: "condition",
      reason: "MULTIPLE_FACES",
    });
    expect(classifyVerification(INVALID_SESSION)).toMatchObject({
      verdict: "unavailable",
      reason: "SESSION_NOT_FOUND",
    });
  });

  it("reads the live mismatch payload as a mismatch, not a frame condition", () => {
    expect(classifyVerification(LIVE_MISMATCH)).toEqual({
      verdict: "mismatch",
      confidence: 0.07679013907909393,
      serverTotal: 2,
    });
  });

  it("reads the live match payload as a match", () => {
    expect(classifyVerification(LIVE_MATCH)).toEqual({ verdict: "match", confidence: 1 });
  });

  it("treats an operational failure as unavailable even when a condition came with it", () => {
    expect(classifyVerification({ ...NO_FACE, error: "SESSION_NOT_FOUND" })).toMatchObject({
      verdict: "unavailable",
    });
  });

  it("will not read a verdict out of a call that did not succeed", () => {
    expect(classifyVerification(UNEXPLAINED_FAILURE)).toMatchObject({
      verdict: "no_verdict",
      reason: "unsuccessful_response",
    });
  });

  it("refuses to read a verdict out of a response it does not recognize", () => {
    expect(classifyVerification({ success: true }).verdict).toBe("no_verdict");
    expect(classifyVerification({ success: false }).verdict).toBe("no_verdict");
    expect(classifyVerification(null).verdict).toBe("no_verdict");
  });
});

describe("useFaceMatchMonitoring", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
  });

  it("ends the interview on two consecutive mismatches", async () => {
    const { autoSubmit, sample, result } = setup();

    await sample(MISMATCH, 1);
    expect(autoSubmit).not.toHaveBeenCalled();
    expect(result.current.mismatchCount).toBe(1);

    await sample(MISMATCH, 1);

    await waitFor(() => expect(autoSubmit).toHaveBeenCalledTimes(1));
    expect(autoSubmit).toHaveBeenCalledWith(TERMINATION_REASONS.FACE_MISMATCH);
  });

  it("ends the interview on two consecutive live mismatch payloads", async () => {
    const { autoSubmit, sample } = setup();
    await sample(LIVE_MISMATCH, 2);
    await waitFor(() => expect(autoSubmit).toHaveBeenCalledWith(TERMINATION_REASONS.FACE_MISMATCH));
  });

  it("says nothing while the candidate keeps matching", async () => {
    const { autoSubmit, onViolation, sample } = setup();
    await sample(LIVE_MATCH, 4);
    expect(onViolation).not.toHaveBeenCalled();
    expect(autoSubmit).not.toHaveBeenCalled();
  });

  it("warns on the first mismatch without spending a proctoring strike", async () => {
    const { autoSubmit, onViolation, sample } = setup();
    await sample(LIVE_MISMATCH, 1);
    expect(autoSubmit).not.toHaveBeenCalled();
    expect(onViolation).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "FACE_MISMATCH",
        titleKey: "violations.faceMismatch.title",
        countsAsViolation: false,
        finalWarning: true,
      }),
    );
  });

  it("shows no warning on the mismatch that ends the interview", async () => {
    const { onViolation, sample } = setup();
    await sample(LIVE_MISMATCH, 2);
    const mismatchWarnings = onViolation.mock.calls.filter(([v]) => v.type === "FACE_MISMATCH");
    expect(mismatchWarnings).toHaveLength(1);
  });

  it("logs the service tally next to our consecutive run", async () => {
    const events = [];
    const unsubscribe = subscribeToViolationLog((e) => events.push(e));
    const { sample } = setup();
    await sample(LIVE_MISMATCH, 1);
    unsubscribe();

    expect(events).toContainEqual(
      expect.objectContaining({ outcome: "raised", violation_count: 1, server_total: 2 }),
    );
  });

  it("submits once even as further samples arrive", async () => {
    const { autoSubmit, sample } = setup();

    await sample(MISMATCH, 8);

    expect(autoSubmit).toHaveBeenCalledTimes(1);
  });

  it("needs the mismatches to be consecutive", async () => {
    const { autoSubmit, sample, result } = setup();

    await sample(MISMATCH, 1);
    await sample(MATCH, 1);
    await sample(MISMATCH, 1);

    expect(result.current.mismatchCount).toBe(1);
    expect(autoSubmit).not.toHaveBeenCalled();
  });

  it.each([
    ["a no-face frame", NO_FACE],
    ["a multiple-faces frame", MULTIPLE_FACES],
    ["an invalid session", INVALID_SESSION],
    ["an unexplained failure", UNEXPLAINED_FAILURE],
  ])("never strikes on %s", async (_label, response) => {
    const { autoSubmit, sample, result } = setup();

    await sample(response, 10);

    expect(result.current.mismatchCount).toBe(0);
    expect(autoSubmit).not.toHaveBeenCalled();
  });

  it.each([
    ["a frame condition", NO_FACE],
    ["an invalid session", INVALID_SESSION],
  ])("breaks the streak on %s", async (_label, response) => {
    const { autoSubmit, sample, result } = setup();

    await sample(MISMATCH, 1);
    await sample(response, 1);
    await sample(MISMATCH, 1);

    expect(result.current.mismatchCount).toBe(1);
    expect(autoSubmit).not.toHaveBeenCalled();
  });

  it("breaks the streak on a failed request", async () => {
    const { autoSubmit, sample, failSample, result } = setup();

    await sample(MISMATCH, 1);
    await failSample(1);
    await sample(MISMATCH, 1);

    expect(result.current.mismatchCount).toBe(1);
    expect(autoSubmit).not.toHaveBeenCalled();
  });

  it("breaks the streak across a blind stretch", async () => {
    const { autoSubmit, sample, gap, result } = setup();

    await sample(MISMATCH, 1);
    gap(RESEED_AFTER_GAP_MS + 5000);
    await sample(MISMATCH, 1);

    expect(result.current.mismatchCount).toBe(1);
    expect(autoSubmit).not.toHaveBeenCalled();
  });

  it("raises the multiple-people warning with its own artwork", async () => {
    const { onViolation, sample } = setup();

    await sample(MULTIPLE_FACES, 1);

    expect(onViolation).toHaveBeenCalledTimes(1);
    expect(onViolation).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "MULTIPLE_FACES",
        imagePath: "/multi-people.png",
        titleKey: "violations.multipleFaces.title",
      }),
    );
  });

  it("warns on a no-face frame rather than waiting for detection to agree", async () => {
    const { onViolation, sample } = setup();

    await sample(NO_FACE, 1);

    expect(onViolation).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "NO_FACE",
        imagePath: "/no-candidate.png",
        titleKey: "violations.noFace.title",
        detail: { origin: "face_match" },
      }),
    );
  });

  it("stops verifying once the session is repeatedly rejected", async () => {
    const { sample, result } = setup();

    await sample(INVALID_SESSION, 3);
    await waitFor(() => expect(result.current.isVerificationUnavailable).toBe(true));

    const callsWhenGivenUp = mutateAsync.mock.calls.length;
    await sample(MISMATCH, 2);

    expect(mutateAsync).toHaveBeenCalledTimes(callsWhenGivenUp);
  });

  it("recovers from a transient error without losing verification", async () => {
    const { sample, result } = setup();

    await sample({ ...INVALID_SESSION, error: "UPSTREAM_TIMEOUT" }, 2);
    await sample(MATCH, 1);
    await sample({ ...INVALID_SESSION, error: "UPSTREAM_TIMEOUT" }, 2);

    expect(result.current.isVerificationUnavailable).toBe(false);
  });

  it("ignores samples until the reference face is registered", async () => {
    const { sample, result } = setup({ isReady: false });

    await sample(MISMATCH, 4);

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(result.current.mismatchCount).toBe(0);
  });

  it("does not log a record for every matching frame", async () => {
    const events = [];
    const unsubscribe = subscribeToViolationLog((event) => events.push(event));

    const { sample } = setup();
    await sample(MATCH, 20);
    unsubscribe();

    expect(events).toHaveLength(0);
  });

  it("logs the recovery when a mismatch clears", async () => {
    const events = [];
    const unsubscribe = subscribeToViolationLog((event) => events.push(event));

    const { sample } = setup();
    await sample(MISMATCH, 1);
    await sample(MATCH, 3);
    unsubscribe();

    expect(events.filter((e) => e.outcome === "cleared")).toHaveLength(1);
  });

  it("reports itself stopped once verification is given up on", async () => {
    const { sample, result } = setup();

    await sample(INVALID_SESSION, 3);

    await waitFor(() => expect(result.current.isMonitoringStopped).toBe(true));
  });

  it("still terminates while detection is backed off", async () => {
    const { autoSubmit, sample } = setup();

    await sample(MISMATCH, 2, BACKED_OFF);

    await waitFor(() => expect(autoSubmit).toHaveBeenCalledTimes(1));
  });

  it("tells the log which model saw the second person", async () => {
    const { onViolation, sample } = setup();

    await sample(MULTIPLE_FACES, 1);

    expect(onViolation).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { origin: "face_match" } }),
    );
  });

  it("records once that the interview ran without a registered face", async () => {
    const events = [];
    const unsubscribe = subscribeToViolationLog((event) => events.push(event));

    const { sample } = setup({ isReady: false });
    await sample(MISMATCH, 5);
    unsubscribe();

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(events.filter((e) => e.outcome === "not_registered")).toHaveLength(1);
  });

  it("records every decision, including the termination", async () => {
    const events = [];
    const unsubscribe = subscribeToViolationLog((event) => events.push(event));

    const { sample } = setup();
    await sample(NO_FACE, 1);
    await sample(MISMATCH, 2);
    await waitFor(() => expect(events.some((e) => e.outcome === "terminated")).toBe(true));
    unsubscribe();

    expect(events.find((e) => e.outcome === "condition")).toMatchObject({
      condition: "NO_FACE",
    });
    expect(events.filter((e) => e.outcome === "raised")).toHaveLength(2);
    expect(events.find((e) => e.outcome === "raised")).toMatchObject({ confidence: 0.21 });
    expect(events.find((e) => e.outcome === "terminated")).toMatchObject({
      source: "face_match",
      type: "FACE_MISMATCH",
      violation_count: 2,
    });
  });
});
