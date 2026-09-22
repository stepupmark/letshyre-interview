import {
  faceMismatchSummary,
  recordInterviewEnded,
  recordViolationEvent,
  resetViolationSummary,
  subscribeToViolationLog,
} from "./violationLog";

function capture() {
  const seen = [];
  const stop = subscribeToViolationLog((event) => seen.push(event));
  return { seen, stop };
}

describe("violationLog", () => {
  it("delivers an event to a subscriber", () => {
    const seen = [];
    const stop = subscribeToViolationLog((event) => seen.push(event));

    recordViolationEvent({ source: "ai", outcome: "raised" });

    expect(seen).toEqual([
      { source: "ai", outcome: "raised", category: "detection", counts_as_strike: false },
    ]);
    stop();
  });

  it("delivers to every subscriber", () => {
    const a = vi.fn();
    const b = vi.fn();
    const stopA = subscribeToViolationLog(a);
    const stopB = subscribeToViolationLog(b);

    recordViolationEvent({ source: "tab_switch" });

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    stopA();
    stopB();
  });

  it("stops delivering once unsubscribed", () => {
    const listener = vi.fn();
    const stop = subscribeToViolationLog(listener);

    stop();
    recordViolationEvent({ source: "ai" });

    expect(listener).not.toHaveBeenCalled();
  });

  it("drops events on the floor when nobody is listening", () => {
    expect(() => recordViolationEvent({ source: "ai" })).not.toThrow();
  });

  it.each([
    [{ source: "tab_switch", type: "TAB_SWITCH" }, "window"],
    [{ source: "window_focus", type: "WINDOW_FOCUS" }, "window"],
    [{ source: "ai", type: "FACE_MISMATCH" }, "identity"],
    [{ source: "face_match", type: "FACE_MISMATCH" }, "identity"],
    [{ source: "network", type: "NETWORK_DISCONNECT" }, "network"],
    [{ source: "electron", type: "ELECTRON_OVERLAY" }, "desktop"],
    [{ source: "voice", type: "VOICE_MISMATCH" }, "voice"],
    [{ source: "input", type: "INPUT_BLOCKED" }, "input"],
    [{ source: "camera", type: "CAMERA_OFF" }, "detection"],
    [{ source: "somewhere" }, "other"],
  ])("files %o under %s", (event, category) => {
    const { seen, stop } = capture();
    recordViolationEvent(event);
    stop();

    expect(seen[0].category).toBe(category);
  });

  it("keeps a strike flag the caller set", () => {
    const { seen, stop } = capture();
    recordViolationEvent({ source: "ai", counts_as_strike: true, strike_count: 2 });
    stop();

    expect(seen[0]).toMatchObject({ counts_as_strike: true, strike_count: 2 });
  });
});

describe("recordInterviewEnded", () => {
  beforeEach(() => resetViolationSummary());

  it("follows the face mismatch counts as they are logged", () => {
    recordViolationEvent({
      source: "face_match",
      outcome: "raised",
      violation_count: 1,
      total_count: 1,
    });
    recordViolationEvent({ source: "face_match", outcome: "cleared" });
    recordViolationEvent({
      source: "face_match",
      outcome: "raised",
      violation_count: 1,
      total_count: 2,
    });

    expect(faceMismatchSummary()).toEqual({ in_a_row: 1, total: 2 });
  });

  it("explains how the interview ended", () => {
    const { seen, stop } = capture();
    recordInterviewEnded({
      outcome: "terminated",
      reason: "violation_limit",
      strikes: [
        { count: 1, type: "PROHIBITED_OBJECT", label: "cell phone", at: 0 },
        { count: 2, type: "NO_FACE", at: 1000, titleKey: "violations.noFace.title" },
      ],
      strike_count: 2,
      internet_disconnects: 0,
    });
    stop();

    expect(seen[0]).toEqual({
      source: "session",
      type: "INTERVIEW_ENDED",
      category: "session",
      counts_as_strike: false,
      outcome: "terminated",
      reason: "violation_limit",
      strikes: [
        {
          count: 1,
          type: "PROHIBITED_OBJECT",
          label: "cell phone",
          at: "1970-01-01T00:00:00.000Z",
        },
        { count: 2, type: "NO_FACE", at: "1970-01-01T00:00:01.000Z" },
      ],
      strike_count: 2,
      internet_disconnects: 0,
      face_mismatches: { in_a_row: 0, total: 0 },
    });
  });
});
