import { useEffect, useRef } from "react";
import { logger } from "@/lib/logger";
import {
  firstDelivery,
  isElectronHardBlock,
  resolveElectronViolation,
} from "@/lib/electronViolations";
import { recordViolationEvent } from "@/lib/violationLog";

/**
 * @typedef {Object} ViolationPayload
 * @property {string}          id           - UUID; acknowledge with it, repeats keep it
 * @property {string}          code         - What happened, e.g. "blocked_app", "external_display"
 * @property {string|null}     category     - The security check that raised it
 * @property {string[]}        apps         - Display names of the apps involved
 * @property {string}          event        - Human-readable reason e.g. "External display detected"
 * @property {"high"|"medium"} severity     - Raw severity from the Electron detector
 * @property {number}          count        - How many times this event has fired this session
 * @property {boolean}         isHardBlock  - true → terminate session; false → show warning
 * @property {"electron"}      source       - Always "electron"
 * @property {boolean}         [redelivered] - Sent again because it wasn't acknowledged
 * @property {string}          timestamp    - ISO 8601 UTC string
 * @property {number}          [recordingOffsetMs] - How far into the desktop recording, from newer apps
 */

/**
 * Listens for security violation events pushed from the Electron desktop app
 * via the preload IPC bridge (window.electronAPI.onViolation).
 *
 * - Silently no-ops when running in a normal browser (window.electronAPI absent).
 * - Acknowledges by id and handles each id once: the app re-sends anything not
 *   acknowledged, and everything pending after a page load.
 * - An extra display is always a strike (onSoftBlock), even from an older desktop
 *   build that marks it a hard block.
 * - Safe to call multiple times — deregisters the previous listener before
 *   registering a new one (handled by the preload bridge).
 * - Callbacks are always called with the latest version without re-registering
 *   the IPC listener (stable ref pattern).
 *
 * @param {Object}   options
 * @param {(v: ViolationPayload) => void} options.onHardBlock
 *   Called for a hard block.  Use to terminate the session.
 * @param {(v: ViolationPayload) => void} [options.onSoftBlock]
 *   Called for everything else.  Use to raise a strike.
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
      window.electronAPI.acknowledgeViolation?.(violation?.id);
      if (!firstDelivery(violation?.id)) {
        const { type, detail } = resolveElectronViolation(violation);
        recordViolationEvent({
          source: "electron",
          type,
          outcome: "duplicate",
          electron_id: violation.id,
          ...(detail.electron_recording_offset_ms === undefined
            ? {}
            : { electron_recording_offset_ms: detail.electron_recording_offset_ms }),
        });
        return;
      }
      try {
        if (isElectronHardBlock(violation)) {
          onHardRef.current?.(violation);
        } else {
          onSoftRef.current?.(violation);
        }
      } catch (err) {
        // Never let a callback error break the IPC channel
        logger.error("[useElectronViolation] callback threw:", err);
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
