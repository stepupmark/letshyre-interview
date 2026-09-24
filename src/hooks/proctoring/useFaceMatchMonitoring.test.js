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
  confidence: 0.6708521842956543,
  violation: null,
  total_violations: 0,
  error: null,
};
// Someone else in the seat.
const MISMATCH = {
  success: true,
  same_person: false,
  confidence: 0.02764659747481346,
  violation: "FACE_MISMATCH",
  total_violations: 2,
  error: null,
};
// The candidate's own face on a bad frame, which the service still calls a mismatch.
const BORDERLINE = { ...MISMATCH, confidence: 0.515070378780365 };
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
// Someone else in front, more people behind. `success` is false even so.
const MISMATCH_WITH_PEOPLE = { ...MULTIPLE_FACES, violation: "FACE_MISMATCH_AND_MULTIPLE_FACES" };
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
    let answer;
    await act(async () => {
      answer = await result.current.verifySample({ ...frame, capturedAt });
    });
    return answer;
  };

  const sample = async (response, times = 1, frame = CLEAR) => {
    let answer;
    for (let i = 0; i < times; i += 1) {
      capturedAt += 5000;
      mutateAsync.mockResolvedValueOnce(response);
      answer = await send(frame);
    }
    return answer;
  };

  const failSample = async (times = 1) => {
    for (let i = 0; i < times; i += 1) {
      capturedAt += 5000;
      mutateAsync.mockRejectedValueOnce(new Error("network"));
      await send(CLEAR);
    }
  };

  // Frames sent without a scripted response, or never sent at all.
  const frames = async (frame, times = 1) => {
    let answer;
    for (let i = 0; i < times; i += 1) {
      capturedAt += 5000;
      answer = await send(frame);
    }
    return answer;
  };

  const unclear = (times) => frames({ ...CLEAR, faceConfidence: 0.6 }, times);

  // As the camera loop sends it: detection's answer is still on its way.
  const sideBySide = async (response, detection = CLEAR) => {
    capturedAt += 5000;
    mutateAsync.mockResolvedValueOnce(response);
    const callsBefore = mutateAsync.mock.calls.length;
    let answer;
    let sentEarly;
    await act(async () => {
      let answerDetection;
      const pending = result.current.verifySample({
        file: CLEAR.file,
        capturedAt,
        detection: new Promise((resolve) => {
          answerDetection = resolve;
        }),
      });
      sentEarly = mutateAsync.mock.calls.length > callsBefore;
      answerDetection({ faceCount: detection.faceCount, faceConfidence: detection.faceConfidence });
      answer = await pending;
    });
    return { answer, sentEarly };
  };

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
    sideBySide,
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
  it.each([
    ["the same person", MATCH, { verdict: "match" }],
    ["a mismatch", MISMATCH, { verdict: "mismatch", confidence: MISMATCH.confidence }],
    ["no face", NO_FACE, { verdict: "condition", faces: "none" }],
    ["several people", MULTIPLE_FACES, { verdict: "condition", faces: "multiple" }],
    [
      "a mismatch with people behind",
      MISMATCH_WITH_PEOPLE,
      { verdict: "mismatch", faces: "multiple" },
    ],
    ["an invalid session", INVALID_SESSION, { verdict: "not_registered" }],
  ])("reads %s", (_label, response, expected) => {
    expect(classifyVerification(response)).toMatchObject(expected);
  });

  it("reads the verdict whatever success says", () => {
    expect(classifyVerification({ ...MISMATCH, success: false }).verdict).toBe("mismatch");
    expect(classifyVerification({ ...MATCH, success: false }).verdict).toBe("match");
  });

  it("treats an operational failure as unavailable even when a condition came with it", () => {
    expect(classifyVerification({ ...NO_FACE, error: "UPSTREAM_TIMEOUT" })).toMatchObject({
      verdict: "unavailable",
    });
  });

  it("takes no verdict from same_person false without a violation", () => {
    expect(classifyVerification(UNEXPLAINED_FAILURE).verdict).toBe("no_verdict");
  });

  it("keeps an unknown violation out of both counts", () => {
    expect(classifyVerification({ ...NO_FACE, violation: "SOMETHING_NEW" })).toEqual({
      verdict: "no_verdict",
      reason: "unknown_violation",
      violation: "SOMETHING_NEW",
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

    await sample(MISMATCH, 2);
    expect(autoSubmit).not.toHaveBeenCalled();
    expect(result.current.mismatchCount).toBe(1);

    await sample(MISMATCH);

    expect(autoSubmit).toHaveBeenCalledTimes(1);
    expect(autoSubmit).toHaveBeenCalledWith(TERMINATION_REASONS.FACE_MISMATCH);
    expect(result.current.isMonitoringStopped).toBe(true);
  });

  it("ends the interview on two live mismatch payloads", async () => {
    const { autoSubmit, sample } = setup();
    await sample(LIVE_MISMATCH, 3);
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
    await sample(LIVE_MISMATCH, 2);

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
    const { autoSubmit, sample, mismatchWarnings } = setup();
    await sample(LIVE_MISMATCH, 3);
    expect(autoSubmit).toHaveBeenCalled();
    expect(mismatchWarnings()).toHaveLength(1);
  });

  it("submits once even as further samples arrive", async () => {
    const { autoSubmit, sample } = setup();
    await sample(MISMATCH, 8);
    expect(autoSubmit).toHaveBeenCalledTimes(1);
  });

  it("resets the run on a match", async () => {
    const { autoSubmit, sample, result } = setup();

    await sample(MISMATCH, 2);
    await sample(MATCH);
    await sample(MISMATCH, 2);

    expect(result.current.mismatchCount).toBe(1);
    expect(autoSubmit).not.toHaveBeenCalled();
  });

  it("ends on the third mismatch of the interview, matches or not", async () => {
    const { autoSubmit, sample, mismatchWarnings } = setup();

    await sample(MISMATCH, 2);
    await sample(MATCH, 3);
    await sample(MISMATCH, 2);
    await sample(MATCH, 3);
    expect(autoSubmit).not.toHaveBeenCalled();

    await sample(MISMATCH, 2);

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

    await s.sample(MISMATCH, 2);
    await between(s);
    // After a frame that wasn't clear, the first mismatch waits for a second look.
    await s.sample(MISMATCH, 2);

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

  it("does not ask the service about a frame with no face", async () => {
    const { frames, onViolation } = setup();

    await frames({ ...CLEAR, faceCount: 0 });

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(onViolation).not.toHaveBeenCalled();
  });
});

describe("useFaceMatchMonitoring faces the service saw", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    config.strongBelow = 0;
  });

  it.each([
    ["a match", MATCH, "one"],
    ["a mismatch", MISMATCH, "one"],
    ["no face", NO_FACE, "none"],
    ["several people", MULTIPLE_FACES, "multiple"],
    ["a mismatch with people behind", MISMATCH_WITH_PEOPLE, "multiple"],
    ["a response with no verdict", UNEXPLAINED_FAILURE, null],
    ["a service error", UPSTREAM_ERROR, null],
  ])("reports %s to the camera loop", async (_label, response, faces) => {
    const { sample } = setup();
    expect(await sample(response)).toMatchObject({ faces });
  });

  it("reports nothing for a frame it did not send", async () => {
    const { frames } = setup();
    expect(await frames({ ...CLEAR, faceCount: 0 })).toBeUndefined();
  });

  it("counts a mismatch with people behind towards identity too", async () => {
    const { autoSubmit, sample, mismatchWarnings } = setup();

    await sample(MISMATCH_WITH_PEOPLE, 2);
    expect(mismatchWarnings()).toHaveLength(1);

    expect(await sample(MISMATCH_WITH_PEOPLE)).toMatchObject({ faces: null });
    expect(autoSubmit).toHaveBeenCalledWith(TERMINATION_REASONS.FACE_MISMATCH);
  });

  it("checks frames with several faces, needing one more mismatch to end", async () => {
    const { autoSubmit, sample } = setup();
    const crowded = { ...CLEAR, faceCount: 2 };

    await sample(MISMATCH_WITH_PEOPLE, 3, crowded);
    expect(mutateAsync).toHaveBeenCalledTimes(3);
    expect(autoSubmit).not.toHaveBeenCalled();

    await sample(MISMATCH_WITH_PEOPLE, 1, crowded);
    expect(autoSubmit).toHaveBeenCalledTimes(1);
  });

  it("never counts no face or several people as a mismatch", async () => {
    const { autoSubmit, sample, result } = setup();

    await sample(NO_FACE, 3);
    await sample(MULTIPLE_FACES, 3);

    expect(result.current.mismatchCount).toBe(0);
    expect(autoSubmit).not.toHaveBeenCalled();
  });

  it("logs a violation it does not know", async () => {
    const { events, unsubscribe } = captureLog();
    const { sample, onViolation } = setup();
    await sample({ ...NO_FACE, violation: "SOMETHING_NEW" });
    unsubscribe();

    expect(onViolation).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        outcome: "no_verdict",
        reason: "unknown_violation",
        violation: "SOMETHING_NEW",
      }),
    );
  });
});

describe("useFaceMatchMonitoring alongside detection", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    config.strongBelow = 0;
  });

  it.each([
    ["a match", MATCH, "one", undefined],
    ["a mismatch", MISMATCH, "one", "held"],
    ["no face", NO_FACE, "none", "condition"],
    ["several people", MULTIPLE_FACES, "multiple", "condition"],
    ["a mismatch with people behind", MISMATCH_WITH_PEOPLE, "multiple", "held"],
    ["an invalid session", INVALID_SESSION, null, "reregistering"],
  ])(
    "sends %s before detection answers, then judges it",
    async (_label, response, faces, outcome) => {
      const onNotRegistered = vi.fn();
      const { sideBySide } = setup({ onNotRegistered });
      const { events, unsubscribe } = captureLog();

      const { answer, sentEarly } = await sideBySide(response);
      unsubscribe();

      expect(sentEarly).toBe(true);
      expect(answer).toMatchObject({ faces, verifyMs: expect.any(Number) });
      if (outcome) expect(events.map((e) => e.outcome)).toContain(outcome);
      expect(onNotRegistered).toHaveBeenCalledTimes(response === INVALID_SESSION ? 1 : 0);
    },
  );

  it("ends on two mismatches in a row", async () => {
    const { autoSubmit, sideBySide } = setup();
    await sideBySide(MISMATCH);
    await sideBySide(MISMATCH);
    await sideBySide(MISMATCH);
    expect(autoSubmit).toHaveBeenCalledWith(TERMINATION_REASONS.FACE_MISMATCH);
  });

  it("never counts identity on a frame detection found empty, though its faces still count", async () => {
    const { autoSubmit, sideBySide, mismatchWarnings } = setup();
    const empty = { ...CLEAR, faceCount: 0 };

    await sideBySide(MISMATCH, empty);
    await sideBySide(MISMATCH, empty);
    const { answer } = await sideBySide(MISMATCH_WITH_PEOPLE, empty);

    expect(mutateAsync).toHaveBeenCalledTimes(3);
    expect(answer.faces).toBe("multiple");
    expect(mismatchWarnings()).toHaveLength(0);
    expect(autoSubmit).not.toHaveBeenCalled();
  });

  it("skips an unclear face once detection scores it", async () => {
    const { sideBySide, onViolation, requestSample } = setup();
    const { events, unsubscribe } = captureLog();

    await sideBySide(MISMATCH, { ...CLEAR, faceConfidence: 0.6 });
    unsubscribe();

    expect(onViolation).not.toHaveBeenCalled();
    expect(requestSample).toHaveBeenCalledWith("face_unclear");
    expect(events.map((e) => e.outcome)).toContain("skipped");
  });

  it("holds the first mismatch after an empty frame for a second look", async () => {
    const { sideBySide, onViolation, requestSample } = setup();

    await sideBySide(MATCH);
    await sideBySide(NO_FACE, { ...CLEAR, faceCount: 0 });
    await sideBySide(MISMATCH);

    expect(onViolation).not.toHaveBeenCalled();
    expect(requestSample).toHaveBeenCalledWith("face_recheck", 1_000);
  });

  it("needs one more mismatch when detection failed on the frames", async () => {
    const { autoSubmit, sideBySide } = setup();
    const unknown = { faceCount: undefined, faceConfidence: undefined };

    await sideBySide(MISMATCH, unknown);
    await sideBySide(MISMATCH, unknown);
    await sideBySide(MISMATCH, unknown);
    expect(autoSubmit).not.toHaveBeenCalled();

    await sideBySide(MISMATCH, unknown);
    expect(autoSubmit).toHaveBeenCalledTimes(1);
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

    await sample(MISMATCH, 3, UNCHECKED);
    expect(autoSubmit).not.toHaveBeenCalled();
    expect(mismatchWarnings()).toHaveLength(2);

    await sample(MISMATCH, 1, UNCHECKED);
    expect(autoSubmit).toHaveBeenCalledTimes(1);
  });

  it("ends on a clear mismatch after an unchecked one", async () => {
    const { autoSubmit, sample } = setup();

    await sample(MISMATCH, 2, UNCHECKED);
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
    const { sample, unclear, onViolation } = setup();
    await sample(MATCH);

    await unclear(5);
    await sample(MATCH);
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

    await sample(MISMATCH, 2);
    await unclear(1);
    expect(result.current.mismatchCount).toBe(1);

    await sample(MISMATCH, 2);
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
    await sample({ ...MISMATCH, confidence: 0.2 }, 2);

    expect(autoSubmit).not.toHaveBeenCalled();
  });
});

describe("useFaceMatchMonitoring borderline scores", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    config.strongBelow = 0;
  });

  it("does not warn when the candidate's own face dips below the service's line", async () => {
    const { sample, mismatchWarnings, result } = setup();
    const { events, unsubscribe } = captureLog();

    await sample(MATCH);
    await sample(BORDERLINE, 3);
    await sample(MATCH);
    unsubscribe();

    expect(mismatchWarnings()).toHaveLength(0);
    expect(result.current.mismatchCount).toBe(0);
    expect(events.filter((e) => e.outcome === "borderline")).toHaveLength(3);
    expect(events.find((e) => e.outcome === "borderline")).toMatchObject({ type: "FACE_CHECK" });
  });

  it("counts a look-alike who never scores clearly once a minute, like an unclear face", async () => {
    const { autoSubmit, sample, mismatchWarnings } = setup();

    await sample(MATCH);
    await sample(BORDERLINE, 12);
    expect(mismatchWarnings()).toHaveLength(1);

    await sample(BORDERLINE, 12);
    expect(autoSubmit).toHaveBeenCalledWith(TERMINATION_REASONS.FACE_MISMATCH);
  });

  it("shows how many identity checks have failed on the warning", async () => {
    const { sample, onViolation } = setup();
    await sample(MISMATCH, 2);
    expect(onViolation).toHaveBeenCalledWith(
      expect.objectContaining({ identityCheck: { count: 1, limit: 3 } }),
    );
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
    await sample(MISMATCH, 2);
    await sample(MATCH, 5);
    unsubscribe();

    expect(events.filter((e) => e.outcome === "matched")).toHaveLength(0);
  });

  it("logs both counts, the scores and the service tally with a mismatch", async () => {
    const { events, unsubscribe } = captureLog();
    const { sample } = setup();
    await sample(LIVE_MISMATCH, 2);
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
    await sample(MISMATCH, 2);
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
    await sample(MISMATCH, 3);
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

describe("useFaceMatchMonitoring after the face comes back", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    config.strongBelow = 0;
  });

  const noFace = { ...CLEAR, faceCount: 0 };

  it("holds the first mismatch and drops it when a second look matches", async () => {
    const { sample, frames, onViolation, requestSample, result } = setup();
    const { events, unsubscribe } = captureLog();

    await sample(MATCH);
    await frames(noFace);
    await sample(MISMATCH);

    expect(onViolation).not.toHaveBeenCalled();
    expect(requestSample).toHaveBeenCalledWith("face_recheck", 1_000);

    await sample(MATCH);
    unsubscribe();

    expect(result.current.mismatchCount).toBe(0);
    expect(events.map((event) => [event.type, event.outcome])).toEqual(
      expect.arrayContaining([
        ["FACE_MISMATCH", "held"],
        ["FACE_CHECK", "settled"],
      ]),
    );
  });

  it("counts it once the second look agrees", async () => {
    const { sample, frames, mismatchWarnings } = setup();

    await sample(MATCH);
    await frames({ ...CLEAR, faceConfidence: 0.6 });
    await sample(MISMATCH, 2);

    expect(mismatchWarnings()).toHaveLength(1);
  });

  it("still catches someone else sitting down after the seat was empty", async () => {
    const { autoSubmit, sample, frames } = setup();

    await sample(MATCH);
    await frames(noFace, 2);
    await sample(MISMATCH, 3);

    expect(autoSubmit).toHaveBeenCalledWith(TERMINATION_REASONS.FACE_MISMATCH);
  });

  it("holds a lone mismatch among matches and drops it when the next look matches", async () => {
    const { sample, mismatchWarnings, requestSample, result } = setup();

    await sample(MATCH);
    await sample(MISMATCH);
    expect(mismatchWarnings()).toHaveLength(0);
    expect(requestSample).toHaveBeenCalledWith("face_recheck", 1_000);

    await sample(MATCH);
    expect(result.current.mismatchCount).toBe(0);
  });

  it("does not hold a mismatch inside a run", async () => {
    const { sample, mismatchWarnings } = setup();

    await sample(MATCH);
    await sample(MISMATCH, 2);
    expect(mismatchWarnings()).toHaveLength(1);
  });

  it("does not hold a mismatch below the instant-ending cutoff", async () => {
    config.strongBelow = 0.1;
    const { autoSubmit, sample, frames } = setup();

    await sample(MATCH);
    await frames(noFace);
    await sample(LIVE_MISMATCH);

    expect(autoSubmit).toHaveBeenCalledTimes(1);
  });

  it("names records that are not mismatches FACE_CHECK", async () => {
    const { sample } = setup();
    const { events, unsubscribe } = captureLog();

    await sample(MATCH);
    await sample(MISMATCH, 2);
    await sample(MATCH);
    unsubscribe();

    expect(events.map((event) => [event.type, event.outcome])).toEqual([
      ["FACE_CHECK", "matched"],
      ["FACE_MISMATCH", "held"],
      ["FACE_MISMATCH", "raised"],
      ["FACE_CHECK", "cleared"],
    ]);
  });
});
