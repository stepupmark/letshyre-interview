import { useEffect, useRef } from "react";
import { logger } from "@/lib/logger";
import { END_REASONS, toEndReason } from "@/lib/terminationReasons";

/**
 * Signals Electron that the interview session has ended.
 * Electron will lift kiosk mode, restore close/minimize, and stop all detection.
 *
 * Safe to use in a regular browser — no-ops when window.electronAPI is absent.
 *
 * @param {{
 *   isCompleted: boolean,
 *   isTerminated: boolean,
 *   isExpired: boolean,
 *   autoSubmitSuccess: boolean,
 *   autoSubmitReason?: string,
 * }} sessionState
 */
export function useInterviewComplete({
  isCompleted,
  isTerminated,
  isExpired,
  autoSubmitSuccess,
  autoSubmitReason,
}) {
  // Guard: fire the signal only once per session, even if state flickers
  const hasFiredRef = useRef(false);

  useEffect(() => {
    if (hasFiredRef.current) return;
    if (!window.electronAPI?.interviewComplete) return; // not inside Electron

    // Every auto-submit freezes the session as expired first, so without the
    // auto-submit reason a security block would be reported as "expired".
    let reason = null;

    if (isCompleted)
      reason = autoSubmitReason ? toEndReason(autoSubmitReason) : END_REASONS.COMPLETED;
    else if (isExpired)
      reason = autoSubmitReason ? toEndReason(autoSubmitReason) : END_REASONS.EXPIRED;
    else if (isTerminated) reason = END_REASONS.TERMINATED;
    else if (autoSubmitSuccess) reason = toEndReason(autoSubmitReason);

    if (!reason) return; // session still active — nothing to signal yet

    hasFiredRef.current = true;
    window.electronAPI.interviewComplete(reason);
    logger.log("[useInterviewComplete] signalled Electron — reason:", reason);
  }, [isCompleted, isTerminated, isExpired, autoSubmitSuccess, autoSubmitReason]);
}
