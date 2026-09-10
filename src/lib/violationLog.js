/**
 * One channel for every violation decision, whatever raised it.
 *
 * The proctoring queue lives in useProctoringSystem, but tab switches,
 * fullscreen exits, window resizes and Electron blocks are raised from
 * useViolationMonitor and used to strike candidates without leaving any record
 * at all. Both now publish here and the queue subscribes, so a terminated
 * interview can always be reconstructed.
 */

const listeners = new Set();

export function subscribeToViolationLog(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function recordViolationEvent(event) {
  for (const listener of listeners) listener(event);
}
