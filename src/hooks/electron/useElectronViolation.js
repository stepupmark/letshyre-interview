// hooks/electron/useElectronViolation.js
import { useEffect, useRef } from "react";

/**
 * @typedef {Object} ViolationPayload
 * @property {string}          event        - Human-readable reason e.g. "External display detected"
 * @property {"high"|"medium"} severity     - Raw severity from the Electron detector
 * @property {number}          count        - How many times this event has fired this session
 * @property {boolean}         isHardBlock  - true → terminate session; false → show warning
 * @property {"electron"}      source       - Always "electron"
 * @property {string}          timestamp    - ISO 8601 UTC string
 */

/**
 * Listens for security violation events pushed from the Electron desktop app
 * via the preload IPC bridge (window.electronAPI.onViolation).
 *
 * - Silently no-ops when running in a normal browser (window.electronAPI absent).
 * - Safe to call multiple times — deregisters the previous listener before
 *   registering a new one (handled by the preload bridge).
 * - Callbacks are always called with the latest version without re-registering
 *   the IPC listener (stable ref pattern).
 *
 * @param {Object}   options
 * @param {(v: ViolationPayload) => void} options.onHardBlock
 *   Called when isHardBlock === true.  Use to terminate the session.
 * @param {(v: ViolationPayload) => void} [options.onSoftBlock]
 *   Called when isHardBlock === false.  Use to show a warning toast.
 *
 * @returns {{ isElectron: boolean }}
 *   isElectron — true if the page is running inside the Electron BrowserWindow.
 *   Use this to conditionally show/hide Electron-specific UI.
 *
 * @example
 * const { isElectron } = useElectronViolation({
 *   onHardBlock: (v) => terminateSession(v),
 *   onSoftBlock: (v) => showWarningToast(v),
 * });
 */
export function useElectronViolation({ onHardBlock, onSoftBlock }) {
  const isElectron =
    typeof window !== "undefined" && typeof window.electronAPI?.onViolation === "function";

  // ── Stable ref pattern (React docs "latest ref") ─────────────────────────
  // Keep the refs pointed at the freshest callbacks so the IPC handler never
  // needs to re-register. Synced in an effect rather than during render so a
  // discarded concurrent render can't leave a stale callback behind.
  const onHardRef = useRef(onHardBlock);
  const onSoftRef = useRef(onSoftBlock);
  useEffect(() => {
    onHardRef.current = onHardBlock;
    onSoftRef.current = onSoftBlock;
  });

  // ── IPC listener — register once, never re-register ──────────────────────
  useEffect(() => {
    if (!isElectron) return;

    function handler(violation) {
      try {
        if (violation.isHardBlock) {
          onHardRef.current?.(violation);
        } else {
          onSoftRef.current?.(violation);
        }
      } catch (err) {
        // Never let a callback error break the IPC channel
        console.error("[useElectronViolation] callback threw:", err);
      }
    }

    window.electronAPI.onViolation(handler);

    return () => {
      window.electronAPI?.removeViolationListener?.();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // ↑ intentional empty deps — the effect must run exactly once per mount.
  //   Callbacks stay fresh via refs above.

  return { isElectron };
}
