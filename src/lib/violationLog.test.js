import {
  checkSummary,
  faceMismatchSummary,
  recordCheckStats,
  recordInterviewEnded,
  recordViolationEvent,
  resetViolationSummary,
  subscribeToViolationLog,
} from "./violationLog";
import {
  markRecordingError,
  markRecordingStarted,
  resetProctoringStop,
  stopProctoringOnce,
} from "./electronRecording";

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

  it("times each record against the desktop recording while it runs", () => {
    window.electronAPI = { stopProctoring: vi.fn() };
    resetProctoringStop();
    const { seen, stop } = capture();

    recordViolationEvent({ source: "ai" });
    markRecordingStarted(Date.now() - 4_000);
    recordViolationEvent({ source: "ai" });
    stopProctoringOnce();
    recordViolationEvent({ source: "ai" });
    stop();

    expect(seen[0]).not.toHaveProperty("recording_offset_ms");
    expect(seen[1].recording_offset_ms).toBeGreaterThanOrEqual(4_000);
    expect(seen[1].recording_offset_ms).toBeLessThan(5_000);
    expect(seen[2]).not.toHaveProperty("recording_offset_ms");
    delete window.electronAPI;
    resetProctoringStop();
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
      checks: {
        count: 0,
        per_minute: null,
        detect_ms: { p50: null, p95: null },
        verify_ms: { p50: null, p95: null },
        unobserved_ms: 0,
      },
    });
  });

  it("summarises how closely the camera loop watched", () => {
    for (let i = 0; i < 13; i += 1) {
      recordCheckStats({ at: i * 5_000, detectMs: 100 + i * 10 });
      recordCheckStats({ verifyMs: 400 + i * 100 });
    }
    recordCheckStats({ at: 60_000, unobservedMs: 15_000 });

    const { seen, stop } = capture();
    recordInterviewEnded({ outcome: "completed" });
    stop();

    expect(seen[0].checks).toEqual({
      count: 14,
      per_minute: 13,
      detect_ms: { p50: 160, p95: 220 },
      verify_ms: { p50: 1_000, p95: 1_600 },
      unobserved_ms: 15_000,
    });
  });

  it("reports the desktop recording's health inside the desktop app", () => {
    window.electronAPI = { startProctoring: vi.fn(), stopProctoring: vi.fn() };
    resetProctoringStop();
    markRecordingStarted(Date.parse("2026-09-28T10:00:00Z"));
    markRecordingError("disk full", Date.parse("2026-09-28T10:05:00Z"));

    const { seen, stop } = capture();
    recordInterviewEnded({ outcome: "completed" });
    stop();

    expect(seen[0].recording).toEqual({
      started: true,
      startedAt: "2026-09-28T10:00:00.000Z",
      errors: [{ at: "2026-09-28T10:05:00.000Z", error: "disk full" }],
      stoppedAt: null,
    });
    delete window.electronAPI;
    resetProctoringStop();
  });

  it("leaves the recording out in a plain browser", () => {
    resetProctoringStop();
    const { seen, stop } = capture();
    recordInterviewEnded({ outcome: "completed" });
    stop();

    expect(seen[0]).not.toHaveProperty("recording");
  });

  it("starts the check summary again on reset", () => {
    recordCheckStats({ at: 0, detectMs: 100, unobservedMs: 20_000 });
    resetViolationSummary();

    expect(checkSummary()).toMatchObject({ count: 0, unobserved_ms: 0 });
  });
});
