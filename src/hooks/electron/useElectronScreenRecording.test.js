import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useElectronScreenRecording } from "./useElectronScreenRecording";
import { recordingOffsetMs, recordingSummary, resetProctoringStop } from "@/lib/electronRecording";
import { subscribeToViolationLog } from "@/lib/violationLog";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

let pushes;
let seen;
let stopListening;

beforeEach(() => {
  resetProctoringStop();
  pushes = {};
  window.electronAPI = {
    startProctoring: vi.fn(() => Promise.resolve({ ok: true })),
    stopProctoring: vi.fn(),
    onProctoringStarted: vi.fn((fn) => (pushes.started = fn)),
    onProctoringError: vi.fn((fn) => (pushes.error = fn)),
  };
  seen = [];
  stopListening = subscribeToViolationLog((record) => seen.push(record));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  stopListening();
  delete window.electronAPI;
  vi.restoreAllMocks();
});

const renderActive = () =>
  renderHook(() =>
    useElectronScreenRecording({
      sessionId: "s1",
      interviewId: "i1",
      isActive: true,
      isCompleted: false,
      isTerminated: false,
      isExpired: false,
      autoSubmitSuccess: false,
    }),
  );

it("starts the recording clock when the desktop app says it is live", () => {
  renderActive();
  expect(recordingOffsetMs()).toBeNull();

  pushes.started();

  expect(recordingOffsetMs()).not.toBeNull();
  expect(recordingSummary().started).toBe(true);
  expect(seen).toContainEqual(
    expect.objectContaining({ type: "SCREEN_RECORDING", outcome: "started", category: "desktop" }),
  );
});

it("logs a recording error and keeps it for the summary", () => {
  renderActive();
  pushes.started();

  pushes.error({ error: "encoder crashed" });

  expect(seen).toContainEqual(
    expect.objectContaining({
      type: "SCREEN_RECORDING",
      outcome: "error",
      error: "encoder crashed",
    }),
  );
  expect(recordingSummary().errors).toEqual([{ at: expect.any(String), error: "encoder crashed" }]);
});

it("stops the clock when the recording is stopped on unmount", () => {
  const { unmount } = renderActive();
  pushes.started();

  unmount();

  expect(window.electronAPI.stopProctoring).toHaveBeenCalledTimes(1);
  expect(recordingOffsetMs()).toBeNull();
  expect(recordingSummary().stoppedAt).not.toBeNull();
});
