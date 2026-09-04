import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasStoppedProctoring, resetProctoringStop, stopProctoringOnce } from "./electronRecording";

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
