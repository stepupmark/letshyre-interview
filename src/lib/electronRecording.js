/**
 * Shared state for the desktop app's screen recording.
 *
 * Three places legitimately want to end the recording — ScoreCard.mount,
 * TerminatedUi.mount, and useElectronScreenRecording's safety timer / unmount
 * cleanup — and they cannot see each other's refs, so the stop guard lives at
 * module scope. So does when the recording started, which every proctoring log
 * record is timed against so a reviewer can jump straight to it in the video.
 */

import { redactEvent } from "@/lib/electronViolations";

// Enough to show a pattern without letting a failing recorder bloat the log.
const MAX_ERRORS = 20;

let stopped = false;
const emptyRecording = () => ({ startedAt: null, stoppedAt: null, errors: [] });
let recording = emptyRecording();

/** @returns {boolean} true if this call is the one that actually stopped it. */
export function stopProctoringOnce() {
  if (stopped) return false;
  stopped = true;
  if (recording.startedAt !== null) recording.stoppedAt = Date.now();
  window.electronAPI?.stopProctoring?.();
  return true;
}

export function hasStoppedProctoring() {
  return stopped;
}

/** Call when a new recording starts, so the next session can stop again. */
export function resetProctoringStop() {
  stopped = false;
  recording = emptyRecording();
}

export function markRecordingStarted(at = Date.now()) {
  recording.startedAt = at;
  recording.stoppedAt = null;
}

/** @returns {string | undefined} the error as it was kept, paths redacted. */
export function markRecordingError(error, at = Date.now()) {
  const message = redactEvent(typeof error === "string" ? error : String(error ?? "unknown"));
  if (recording.errors.length < MAX_ERRORS) recording.errors.push({ at, error: message });
  return message;
}

/** Milliseconds into the desktop recording, or null when nothing is recording. */
export function recordingOffsetMs(now = Date.now()) {
  if (recording.startedAt === null || recording.stoppedAt !== null) return null;
  return Math.max(0, now - recording.startedAt);
}

const iso = (at) => (at === null ? null : new Date(at).toISOString());

export function recordingSummary() {
  return {
    started: recording.startedAt !== null,
    startedAt: iso(recording.startedAt),
    errors: recording.errors.map(({ at, error }) => ({ at: iso(at), error })),
    stoppedAt: iso(recording.stoppedAt),
  };
}

/** Whether there is anything to report: inside the desktop app, or a recording was seen. */
export function hasRecordingState() {
  return (
    typeof window.electronAPI?.startProctoring === "function" ||
    recording.startedAt !== null ||
    recording.errors.length > 0
  );
}
