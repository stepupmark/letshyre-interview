/**
 * Idempotent wrapper around Electron's stopProctoring bridge.
 *
 * Three places legitimately want to end the recording — ScoreCard.mount,
 * TerminatedUi.mount, and useElectronScreenRecording's safety timer / unmount
 * cleanup — and they cannot see each other's refs, so each used to fire its
 * own stop. Main tolerates the duplicates, but the 30s safety timer fired on
 * every normal session because nothing told the hook a stop had already
 * happened. The guard lives at module scope so all callers share it.
 */

let stopped = false;

/** @returns {boolean} true if this call is the one that actually stopped it. */
export function stopProctoringOnce() {
  if (stopped) return false;
  stopped = true;
  window.electronAPI?.stopProctoring?.();
  return true;
}

export function hasStoppedProctoring() {
  return stopped;
}

/** Call when a new recording starts, so the next session can stop again. */
export function resetProctoringStop() {
  stopped = false;
}
