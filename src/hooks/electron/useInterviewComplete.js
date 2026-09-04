import { useEffect, useRef } from "react";
import { logger } from "@/lib/logger";

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
 * }} sessionState
 */
export function useInterviewComplete({
  isCompleted,
  isTerminated,
  isExpired,
  autoSubmitSuccess,
}) {
  // Guard: fire the signal only once per session, even if state flickers
  const hasFiredRef = useRef(false);

  useEffect(() => {
    if (hasFiredRef.current) return;
    if (!window.electronAPI?.interviewComplete) return; // not inside Electron

    let reason = null;

    if (isCompleted)            reason = "completed";
    else if (isExpired)         reason = "expired";
    else if (isTerminated)      reason = "terminated";
    else if (autoSubmitSuccess) reason = "auto-submitted";

    if (!reason) return; // session still active — nothing to signal yet

    hasFiredRef.current = true;
    window.electronAPI.interviewComplete(reason);
    logger.log("[useInterviewComplete] signalled Electron — reason:", reason);
  }, [isCompleted, isTerminated, isExpired, autoSubmitSuccess]);
}
