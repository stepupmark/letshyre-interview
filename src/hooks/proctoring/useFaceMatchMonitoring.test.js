import { act, renderHook, waitFor } from "@testing-library/react";
import {
  classifyVerification,
  MAX_REREGISTERS,
  useFaceMatchMonitoring,
} from "./useFaceMatchMonitoring";
import { TERMINATION_REASONS } from "@/lib/terminationReasons";
import { subscribeToViolationLog } from "@/lib/violationLog";

const mutateAsync = vi.fn();
const config = vi.hoisted(() => ({ strongBelow: 0 }));

vi.mock("@mutations/useContinuousVerifyMutation", () => ({
  useContinuousVerifyMutation: () => ({ mutateAsync: (...args) => mutateAsync(...args) }),
}));

vi.mock("@/config/interview", async (importOriginal) => ({
  ...(await importOriginal()),
  get FACE_STRONG_MISMATCH_BELOW() {
    return config.strongBelow;
  },
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
const UPSTREAM_ERROR = { ...INVALID_SESSION, error: "UPSTREAM_TIMEOUT" };

// Nothing says why the call failed, so same_person is a default, not a verdict.
const UNEXPLAINED_FAILURE = {
  success: false,
  same_person: false,
  confidence: 0.2,
  violation: null,
  error: null,
};

const MAX_UNAVAILABLE_FOR_TEST = 3;

// A frame detection vouched for: one face, seen clearly.
const CLEAR = { file: new File(["x"], "frame.jpg"), faceCount: 1, faceConfidence: 0.93 };
// Detection failed on this frame, so neither is known.
const UNCHECKED = { file: CLEAR.file };

function setup(options = {}) {
  const autoSubmit = vi.fn();
  const onViolation = vi.fn();
  const requestSample = vi.fn();

  const { result } = renderHook(() =>
    useFaceMatchMonitoring({
      sessionId: "s1",
      autoSubmit,
      onViolation,
      requestSample,
      ...options,
    }),
  );

  let capturedAt = 0;

  const send = async (frame) => {
    await act(async () => {
      await result.current.verifySample({ ...frame, capturedAt });
    });
  };

  const sample = async (response, times = 1, frame = CLEAR) => {
    for (let i = 0; i < times; i += 1) {
      capturedAt += 5000;
      mutateAsync.mockResolvedValueOnce(response);
      await send(frame);
    }
  };

  const failSample = async (times = 1) => {
    for (let i = 0; i < times; i += 1) {
      capturedAt += 5000;
      mutateAsync.mockRejectedValueOnce(new Error("network"));
      await send(CLEAR);
    }
  };

  // Frames the service never sees: no face, several, or an unclear one.
  const frames = async (frame, times = 1) => {
    for (let i = 0; i < times; i += 1) {
      capturedAt += 5000;
      await send(frame);
    }
  };

  const unclear = (times) => frames({ ...CLEAR, faceConfidence: 0.6 }, times);

  const pause = (ms) => {
    capturedAt += ms;
  };

  const mismatchWarnings = () =>
    onViolation.mock.calls.filter(([violation]) => violation.type === "FACE_MISMATCH");

  return {
    autoSubmit,
    onViolation,
    requestSample,
    sample,
    failSample,
    frames,
    unclear,
    pause,
    mismatchWarnings,
    result,
  };
}

function captureLog() {
  const events = [];
  const unsubscribe = subscribeToViolationLog((event) => events.push(event));
  return { events, unsubscribe };
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
    expect(classifyVerification(INVALID_SESSION)).toMatchObject({ verdict: "not_registered" });
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
    expect(classifyVerification({ ...NO_FACE, error: "UPSTREAM_TIMEOUT" })).toMatchObject({
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

describe("useFaceMatchMonitoring mismatches", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    config.strongBelow = 0;
  });

  it("ends the interview on two mismatches in a row", async () => {
    const { autoSubmit, sample, result } = setup();

    await sample(MISMATCH);
    expect(autoSubmit).not.toHaveBeenCalled();
    expect(result.current.mismatchCount).toBe(1);

    await sample(MISMATCH);

    expect(autoSubmit).toHaveBeenCalledTimes(1);
    expect(autoSubmit).toHaveBeenCalledWith(TERMINATION_REASONS.FACE_MISMATCH);
    expect(result.current.isMonitoringStopped).toBe(true);
  });

  it("ends the interview on two live mismatch payloads", async () => {
    const { autoSubmit, sample } = setup();
    await sample(LIVE_MISMATCH, 2);
    expect(autoSubmit).toHaveBeenCalledWith(TERMINATION_REASONS.FACE_MISMATCH);
  });

  it("says nothing while the candidate keeps matching", async () => {
    const { autoSubmit, onViolation, sample } = setup();
    await sample(LIVE_MATCH, 4);
    expect(onViolation).not.toHaveBeenCalled();
    expect(autoSubmit).not.toHaveBeenCalled();
  });

  it("warns on the first mismatch without a strike and looks again soon", async () => {
    const { autoSubmit, onViolation, requestSample, sample } = setup();
    await sample(LIVE_MISMATCH);

    expect(autoSubmit).not.toHaveBeenCalled();
    expect(onViolation).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "FACE_MISMATCH",
        titleKey: "violations.faceMismatch.title",
        countsAsViolation: false,
        finalWarning: true,
      }),
    );
    expect(requestSample).toHaveBeenCalledWith("face_mismatch");
  });

  it("shows no warning on the mismatch that ends the interview", async () => {
    const { sample, mismatchWarnings } = setup();
    await sample(LIVE_MISMATCH, 2);
    expect(mismatchWarnings()).toHaveLength(1);
  });

  it("submits once even as further samples arrive", async () => {
    const { autoSubmit, sample } = setup();
    await sample(MISMATCH, 8);
    expect(autoSubmit).toHaveBeenCalledTimes(1);
  });

  it("resets the run on a match", async () => {
    const { autoSubmit, sample, result } = setup();

    await sample(MISMATCH);
    await sample(MATCH);
    await sample(MISMATCH);

    expect(result.current.mismatchCount).toBe(1);
    expect(autoSubmit).not.toHaveBeenCalled();
  });

  it("ends on the third mismatch of the interview, matches or not", async () => {
    const { autoSubmit, sample, mismatchWarnings } = setup();

    await sample(MISMATCH);
    await sample(MATCH, 3);
    await sample(MISMATCH);
    await sample(MATCH, 3);
    expect(autoSubmit).not.toHaveBeenCalled();

    await sample(MISMATCH);

    expect(autoSubmit).toHaveBeenCalledTimes(1);
    expect(mismatchWarnings()).toHaveLength(2);
  });

  it.each([
    ["a no-face frame", async (s) => s.frames({ ...CLEAR, faceCount: 0 })],
    ["a multiple-face frame", async (s) => s.frames({ ...CLEAR, faceCount: 2 })],
    ["the service seeing no face", async (s) => s.sample(NO_FACE)],
    ["a response with no verdict", async (s) => s.sample(UNEXPLAINED_FAILURE)],
    ["a failed request", async (s) => s.failSample()],
    ["a service error", async (s) => s.sample(UPSTREAM_ERROR)],
    ["an unclear face", async (s) => s.unclear(1)],
    ["a long pause", async (s) => s.pause(5 * 60_000)],
  ])("keeps the run across %s", async (_label, between) => {
    const s = setup();

    await s.sample(MISMATCH);
    await between(s);
    await s.sample(MISMATCH);

    expect(s.autoSubmit).toHaveBeenCalledWith(TERMINATION_REASONS.FACE_MISMATCH);
  });

  it.each([
    ["a no-face frame", NO_FACE],
    ["a multiple-faces frame", MULTIPLE_FACES],
    ["an invalid session", INVALID_SESSION],
    ["an unexplained failure", UNEXPLAINED_FAILURE],
  ])("never counts %s as a mismatch", async (_label, response) => {
    const { autoSubmit, onViolation, sample, result } = setup();

    await sample(response, 10);

    expect(result.current.mismatchCount).toBe(0);
    expect(onViolation).not.toHaveBeenCalled();
    expect(autoSubmit).not.toHaveBeenCalled();
  });

  it("does not ask the service about a frame without exactly one face", async () => {
    const { frames, onViolation } = setup();

    await frames({ ...CLEAR, faceCount: 0 });
    await frames({ ...CLEAR, faceCount: 2 });

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(onViolation).not.toHaveBeenCalled();
  });
});

describe("useFaceMatchMonitoring frames detection could not check", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    config.strongBelow = 0;
  });

  it("still compares them", async () => {
    const { sample } = setup();
    await sample(MATCH, 1, UNCHECKED);
    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("needs one more mismatch before they can end the interview", async () => {
    const { autoSubmit, sample, mismatchWarnings } = setup();

    await sample(MISMATCH, 2, UNCHECKED);
    expect(autoSubmit).not.toHaveBeenCalled();
    expect(mismatchWarnings()).toHaveLength(2);

    await sample(MISMATCH, 1, UNCHECKED);
    expect(autoSubmit).toHaveBeenCalledTimes(1);
  });

  it("ends on a clear mismatch after an unchecked one", async () => {
    const { autoSubmit, sample } = setup();

    await sample(MISMATCH, 1, UNCHECKED);
    await sample(MISMATCH);

    expect(autoSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("useFaceMatchMonitoring unclear faces", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    config.strongBelow = 0;
  });

  it("skips the unclear faces that produced false mismatches in the live log", async () => {
    const { frames, onViolation, requestSample } = setup();
    const { events, unsubscribe } = captureLog();

    await frames({ ...CLEAR, faceConfidence: 0.759 });
    await frames({ ...CLEAR, faceConfidence: 0.64 });
    unsubscribe();

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(onViolation).not.toHaveBeenCalled();
    expect(requestSample).toHaveBeenCalledWith("face_unclear");
    expect(events.map((e) => [e.outcome, e.face_confidence])).toEqual([
      ["skipped", 0.759],
      ["skipped", 0.64],
    ]);
  });

  it("hints at 30 seconds and counts a mismatch at 60", async () => {
    const { sample, unclear, onViolation, mismatchWarnings, result } = setup();
    await sample(MATCH);

    await unclear(5);
    expect(onViolation).not.toHaveBeenCalled();

    await unclear(1);
    expect(onViolation).toHaveBeenCalledTimes(1);
    expect(onViolation).toHaveBeenCalledWith(
      expect.objectContaining({ type: "FACE_UNCLEAR", soft: true, countsAsViolation: false }),
    );

    await unclear(5);
    expect(mismatchWarnings()).toHaveLength(0);

    await unclear(1);
    expect(mismatchWarnings()).toHaveLength(1);
    expect(result.current.mismatchCount).toBe(1);
  });

  it("ends the interview after two minutes with no clear face", async () => {
    const { autoSubmit, sample, unclear } = setup();
    await sample(MATCH);

    await unclear(12);
    expect(autoSubmit).not.toHaveBeenCalled();

    await unclear(12);
    expect(autoSubmit).toHaveBeenCalledWith(TERMINATION_REASONS.FACE_MISMATCH);
  });

  it("restarts the clock on a clear face", async () => {
    const { sample, unclear, frames, onViolation } = setup();
    await sample(MATCH);

    await unclear(5);
    await frames(CLEAR);
    await unclear(5);

    expect(onViolation).not.toHaveBeenCalled();
  });

  it("does not restart the clock on frames without a face", async () => {
    const { sample, unclear, frames, mismatchWarnings } = setup();
    await sample(MATCH);

    await unclear(6);
    await frames({ ...CLEAR, faceCount: 0 }, 4);
    await unclear(2);

    expect(mismatchWarnings()).toHaveLength(1);
  });

  it("keeps the run across an unclear face", async () => {
    const { autoSubmit, sample, unclear, result } = setup();

    await sample(MISMATCH);
    await unclear(1);
    expect(result.current.mismatchCount).toBe(1);

    await sample(MISMATCH);
    expect(autoSubmit).toHaveBeenCalledWith(TERMINATION_REASONS.FACE_MISMATCH);
  });
});

describe("useFaceMatchMonitoring strong mismatches", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    config.strongBelow = 0;
  });

  it("stays off unless a cutoff is configured", async () => {
    const { autoSubmit, sample } = setup();
    await sample(LIVE_MISMATCH);
    expect(autoSubmit).not.toHaveBeenCalled();
  });

  it("ends on the first clear mismatch below the cutoff", async () => {
    config.strongBelow = 0.1;
    const { autoSubmit, sample, mismatchWarnings } = setup();
    const { events, unsubscribe } = captureLog();

    await sample(LIVE_MISMATCH);
    unsubscribe();

    expect(autoSubmit).toHaveBeenCalledTimes(1);
    expect(mismatchWarnings()).toHaveLength(0);
    expect(events.find((e) => e.outcome === "terminated")).toMatchObject({ rule: "strong" });
  });

  it("only warns when the frame was not checked or the score is above the cutoff", async () => {
    config.strongBelow = 0.1;
    const { autoSubmit, sample } = setup();

    await sample(LIVE_MISMATCH, 1, UNCHECKED);
    await sample(MATCH);
    await sample(MISMATCH);

    expect(autoSubmit).not.toHaveBeenCalled();
  });
});

describe("useFaceMatchMonitoring service outages", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    config.strongBelow = 0;
  });

  it("pauses after repeated errors and probes every 30 seconds", async () => {
    const { sample, frames, result } = setup();

    await sample(UPSTREAM_ERROR, MAX_UNAVAILABLE_FOR_TEST);
    expect(result.current.isVerificationUnavailable).toBe(true);
    const callsWhenPaused = mutateAsync.mock.calls.length;

    await frames(CLEAR, 5);
    expect(mutateAsync).toHaveBeenCalledTimes(callsWhenPaused);

    await sample(MATCH);
    expect(mutateAsync).toHaveBeenCalledTimes(callsWhenPaused + 1);
  });

  it("resumes and logs how long checks were off", async () => {
    const { sample, result } = setup();
    const { events, unsubscribe } = captureLog();

    await sample(UPSTREAM_ERROR, MAX_UNAVAILABLE_FOR_TEST);
    mutateAsync.mockReset();
    await sample(MATCH, 6);
    unsubscribe();

    expect(result.current.isVerificationUnavailable).toBe(false);
    expect(events.find((e) => e.outcome === "verification_restored")).toMatchObject({
      unavailable_ms: 30_000,
    });
  });

  it("counts failed requests towards an outage", async () => {
    const { failSample, result } = setup();
    await failSample(MAX_UNAVAILABLE_FOR_TEST);
    expect(result.current.isVerificationUnavailable).toBe(true);
  });

  it("recovers from a transient error without pausing", async () => {
    const { sample, result } = setup();

    await sample(UPSTREAM_ERROR, 2);
    await sample(MATCH);
    await sample(UPSTREAM_ERROR, 2);

    expect(result.current.isVerificationUnavailable).toBe(false);
  });

  it("does not hold an outage against the candidate's unclear clock", async () => {
    const { sample, unclear, onViolation } = setup();
    await sample(MATCH);

    await sample(UPSTREAM_ERROR, MAX_UNAVAILABLE_FOR_TEST);
    await unclear(20);

    expect(onViolation).not.toHaveBeenCalled();
  });

  it("asks for the face to be registered again when the service lost the session", async () => {
    const onNotRegistered = vi.fn();
    const { sample, result } = setup({ onNotRegistered });

    await sample(INVALID_SESSION);

    expect(onNotRegistered).toHaveBeenCalledTimes(1);
    expect(result.current.isVerificationUnavailable).toBe(false);
  });

  it("treats the session as unavailable once registering again keeps getting lost", async () => {
    const onNotRegistered = vi.fn();
    const { sample, result } = setup({ onNotRegistered });

    await sample(INVALID_SESSION, MAX_REREGISTERS + MAX_UNAVAILABLE_FOR_TEST);

    expect(onNotRegistered).toHaveBeenCalledTimes(MAX_REREGISTERS);
    await waitFor(() => expect(result.current.isVerificationUnavailable).toBe(true));
  });

  it("ignores samples until the reference face is registered", async () => {
    const { sample, result } = setup({ isReady: false });

    await sample(MISMATCH, 4);

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(result.current.mismatchCount).toBe(0);
  });
});

describe("useFaceMatchMonitoring log", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    config.strongBelow = 0;
  });

  it("logs one match a minute, not every matching frame", async () => {
    const { events, unsubscribe } = captureLog();
    const { sample } = setup();
    await sample(MATCH, 20);
    unsubscribe();

    expect(events.map((e) => e.outcome)).toEqual(["matched", "matched"]);
    expect(events[0]).toMatchObject({
      source: "face_match",
      confidence: MATCH.confidence,
      face_confidence: 0.93,
    });
  });

  it("counts a cleared mismatch as the minute's match record", async () => {
    const { events, unsubscribe } = captureLog();
    const { sample } = setup();
    await sample(MISMATCH);
    await sample(MATCH, 5);
    unsubscribe();

    expect(events.filter((e) => e.outcome === "matched")).toHaveLength(0);
  });

  it("logs both counts, the scores and the service tally with a mismatch", async () => {
    const { events, unsubscribe } = captureLog();
    const { sample } = setup();
    await sample(LIVE_MISMATCH);
    unsubscribe();

    expect(events).toContainEqual(
      expect.objectContaining({
        outcome: "raised",
        violation_count: 1,
        total_count: 1,
        vetted: true,
        confidence: 0.07679013907909393,
        face_confidence: 0.93,
        server_total: 2,
      }),
    );
  });

  it("logs the recovery when a mismatch clears", async () => {
    const { events, unsubscribe } = captureLog();
    const { sample } = setup();
    await sample(MISMATCH);
    await sample(MATCH, 3);
    unsubscribe();

    expect(events.filter((e) => e.outcome === "cleared")).toHaveLength(1);
  });

  it("records once that the interview ran without a registered face", async () => {
    const { events, unsubscribe } = captureLog();
    const { sample } = setup({ isReady: false });
    await sample(MISMATCH, 5);
    unsubscribe();

    expect(events.filter((e) => e.outcome === "not_registered")).toHaveLength(1);
  });

  it("records every decision, including which rule ended the interview", async () => {
    const { events, unsubscribe } = captureLog();
    const { sample } = setup();
    await sample(NO_FACE);
    await sample(MISMATCH, 2);
    unsubscribe();

    expect(events.find((e) => e.outcome === "condition")).toMatchObject({
      condition: "NO_FACE",
    });
    expect(events.filter((e) => e.outcome === "raised")).toHaveLength(2);
    expect(events.find((e) => e.outcome === "terminated")).toMatchObject({
      source: "face_match",
      type: "FACE_MISMATCH",
      violation_count: 2,
      total_count: 2,
      rule: "in_a_row",
    });
  });
});
