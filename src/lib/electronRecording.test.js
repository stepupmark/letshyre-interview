import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasRecordingState,
  hasStoppedProctoring,
  markRecordingError,
  markRecordingStarted,
  recordingOffsetMs,
  recordingSummary,
  resetProctoringStop,
  stopProctoringOnce,
} from "./electronRecording";

describe("stopProctoringOnce", () => {
  beforeEach(() => {
    resetProctoringStop();
    window.electronAPI = { stopProctoring: vi.fn() };
  });

  it("forwards the first stop to the Electron bridge", () => {
    expect(stopProctoringOnce()).toBe(true);
    expect(window.electronAPI.stopProctoring).toHaveBeenCalledTimes(1);
  });

  it("collapses the three independent stop paths into one bridge call", () => {
    // ScoreCard.mount, the hook's safety timer and its unmount cleanup all
    // race to stop; main used to receive three proctoring-stop sends.
    stopProctoringOnce();
    stopProctoringOnce();
    stopProctoringOnce();

    expect(window.electronAPI.stopProctoring).toHaveBeenCalledTimes(1);
  });

  it("reports whether this caller was the one that stopped it", () => {
    expect(stopProctoringOnce()).toBe(true);
    expect(stopProctoringOnce()).toBe(false);
  });

  it("lets the next session stop again after a reset", () => {
    stopProctoringOnce();
    resetProctoringStop();

    expect(hasStoppedProctoring()).toBe(false);
    expect(stopProctoringOnce()).toBe(true);
    expect(window.electronAPI.stopProctoring).toHaveBeenCalledTimes(2);
  });

  it("no-ops outside Electron instead of throwing", () => {
    window.electronAPI = undefined;

    expect(() => stopProctoringOnce()).not.toThrow();
    expect(hasStoppedProctoring()).toBe(true);
  });
});

describe("recording health", () => {
  const T0 = Date.parse("2026-09-28T10:00:00Z");

  beforeEach(() => {
    resetProctoringStop();
    window.electronAPI = { startProctoring: vi.fn(), stopProctoring: vi.fn() };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete window.electronAPI;
  });

  it("has no offset until the desktop app says the recording is live", () => {
    expect(recordingOffsetMs(T0)).toBeNull();
    markRecordingStarted(T0);
    expect(recordingOffsetMs(T0 + 12_345)).toBe(12_345);
  });

  it("has no offset once the recording is stopped", () => {
    vi.useFakeTimers({ now: T0 });
    markRecordingStarted(T0);
    vi.setSystemTime(T0 + 60_000);
    stopProctoringOnce();

    expect(recordingOffsetMs(T0 + 61_000)).toBeNull();
    expect(recordingSummary()).toEqual({
      started: true,
      startedAt: "2026-09-28T10:00:00.000Z",
      errors: [],
      stoppedAt: "2026-09-28T10:01:00.000Z",
    });
  });

  it("keeps errors with their time, file paths redacted", () => {
    markRecordingStarted(T0);
    const kept = markRecordingError("cannot write C:\\Users\\ana\\rec.webm", T0 + 1_000);

    expect(kept).toBe("cannot write [path]");
    expect(recordingSummary().errors).toEqual([
      { at: "2026-09-28T10:00:01.000Z", error: "cannot write [path]" },
    ]);
  });

  it("stops keeping errors after twenty", () => {
    for (let i = 0; i < 30; i += 1) markRecordingError(`error ${i}`, T0 + i);
    expect(recordingSummary().errors).toHaveLength(20);
  });

  it("copes with an error push that carries no message", () => {
    expect(markRecordingError(undefined, T0)).toBe("unknown");
  });

  it("reports an error even when the recording never started", () => {
    markRecordingError("no screen source", T0);
    expect(recordingSummary()).toMatchObject({ started: false, startedAt: null, stoppedAt: null });
  });

  it("does not record a stop time for a recording that never started", () => {
    stopProctoringOnce();
    expect(recordingSummary().stoppedAt).toBeNull();
  });

  it("starts clean for the next recording", () => {
    markRecordingStarted(T0);
    markRecordingError("x", T0);
    resetProctoringStop();

    expect(recordingSummary()).toEqual({
      started: false,
      startedAt: null,
      errors: [],
      stoppedAt: null,
    });
  });

  it("has nothing to report in a plain browser", () => {
    delete window.electronAPI;
    expect(hasRecordingState()).toBe(false);
    markRecordingError("x", T0);
    expect(hasRecordingState()).toBe(true);
  });
});
