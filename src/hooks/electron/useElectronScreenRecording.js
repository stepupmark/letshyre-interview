// hooks/electron/useElectronScreenRecording.js
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { resetProctoringStop, stopProctoringOnce } from "@/lib/electronRecording";

/**
 * Starts and stops Electron screen + mic recording around an interview session.
 *
 * - Calls window.electronAPI.startProctoring() once isActive is true and both
 *   session IDs are present.
 * - Calls window.electronAPI.stopProctoring() when the session ends for any
 *   reason (completed / terminated / expired / auto-submitted).
 * - Listens for push events from Electron confirming recording started or errored.
 * - Silently no-ops when window.electronAPI is absent (regular browser).
 *
 * @param {{
 *   sessionId:        string | number | null | undefined,
 *   interviewId:      string | number | null | undefined,
 *   isActive:         boolean,
 *   isCompleted:      boolean,
 *   isTerminated:     boolean,
 *   isExpired:        boolean,
 *   autoSubmitSuccess: boolean,
 * }} params
 */
export function useElectronScreenRecording({
  sessionId,
  interviewId,
  isActive,
  isCompleted,
  isTerminated,
  isExpired,
  autoSubmitSuccess,
}) {
  const isElectron =
    typeof window !== "undefined" && typeof window.electronAPI?.startProctoring === "function";

  // Prevents a double-start across re-renders; the matching stop guard is
  // module-level in electronRecording, shared with the result components.
  const hasStartedRef = useRef(false);

  // ── Push listeners — register once on mount ──────────────────────────────
  useEffect(() => {
    if (!isElectron) return;

    window.electronAPI.onProctoringStarted?.(() => {
      logger.log("[useElectronScreenRecording] screen recording live");
    });

    window.electronAPI.onProctoringError?.(({ error }) => {
      logger.error("[useElectronScreenRecording] recording error:", error);
      toast.error("Screen recording failed. The session will continue without recording.");
    });

    // No explicit cleanup needed — the preload bridge uses removeAllListeners
    // before each registration, so there are no duplicate handlers.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Start — fires once when session becomes active ───────────────────────
  useEffect(() => {
    if (!isElectron) return;
    if (hasStartedRef.current) return;
    if (!isActive || !sessionId || !interviewId) return;

    hasStartedRef.current = true;
    resetProctoringStop();

    window.electronAPI
      .startProctoring({
        sessionId: String(sessionId),
        interviewId: String(interviewId),
      })
      .then((result) => {
        if (!result?.ok) {
          logger.warn(
            "[useElectronScreenRecording] startProctoring returned not-ok:",
            result?.error,
          );
        }
      })
      .catch((err) => {
        logger.error("[useElectronScreenRecording] startProctoring threw:", err);
      });
  }, [isActive, sessionId, interviewId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stop — safety net only ───────────────────────────────────────────────
  // The real stop comes from whichever result component mounts:
  //   isCompleted / isExpired / autoSubmitSuccess → ScoreCard.mount
  //   isTerminated                                → TerminatedUi.mount
  // This fires only if neither ever mounts (scorecard API error, unexpected
  // navigation), so the recording can't run indefinitely. stopProctoringOnce
  // is shared with those components — before it existed this timer fired on
  // every normal session, since their stop was invisible to this hook.
  useEffect(() => {
    if (!isElectron) return;
    if (!hasStartedRef.current) return;

    const sessionEnded = isCompleted || isTerminated || isExpired || autoSubmitSuccess;
    if (!sessionEnded) return;

    const safetyTimer = setTimeout(() => {
      if (stopProctoringOnce()) {
        logger.log(
          "[useElectronScreenRecording] stop — safety timeout (result screen never mounted)",
        );
      }
    }, 30000);

    return () => clearTimeout(safetyTimer);
  }, [isCompleted, isTerminated, isExpired, autoSubmitSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cleanup — stop if component unmounts mid-recording ───────────────────
  useEffect(() => {
    return () => {
      if (!isElectron) return;
      if (hasStartedRef.current) {
        stopProctoringOnce();
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
