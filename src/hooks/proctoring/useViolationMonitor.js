import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { MAX_VIOLATIONS } from "@/config/interview";
import { createStrikePolicy } from "@/lib/strikePolicy";
import { recordViolationEvent } from "@/lib/violationLog";

// Slack against OS chrome and DPI rounding when deciding whether the window is
// still maximized, and how long a shrunk window must persist before it counts.
const RESIZE_TOLERANCE_PX = 40;
const RESIZE_CONFIRM_MS = 1_000;

// The modal blocks every further violation while it is open, so leaving it up
// would mute proctoring for as long as the candidate likes.
const AUTO_DISMISS_MS = 20_000;
// Closing it on a timer gives back the guard that was holding the next strike,
// so leave a gap rather than letting the next event land immediately.
const AUTO_DISMISS_GRACE_MS = 10_000;

// Leaving fullscreen resizes the window, so the resize handler fires right
// behind fullscreenchange. Without this the candidate is struck twice for one
// action.
const CASCADE_WINDOW_MS = 2_000;

export function getElectronViolationKey(event = "") {
  const e = event.toLowerCase();
  if (e.includes("hdmi") || e.includes("display")) return "externalDisplay";
  if (e.includes("mirror") || e.includes("sharing")) return "screenSharing";
  if (e.includes("agent") || e.includes("tamper")) return "securityMonitor";
  if (e.includes("minimize") || e.includes("close")) return "windowAction";
  return "generic";
}

function electronViolationCopy(event) {
  const key = getElectronViolationKey(event);
  return {
    titleKey: `violations.electron.${key}.title`,
    descriptionKey: `violations.electron.${key}.description`,
    imagePath: "/window-switch.png",
  };
}

/**
 * Owns the violation-warning modal (state + raise/dismiss), the anti-cheat DOM
 * listeners that raise it (tab switch, fullscreen exit, window resize,
 * copy/paste/right-click), and the Electron hard/soft-block bridge. Split out
 * of the interview page so that component stays focused on layout/rendering.
 */
export function useViolationMonitor({ isActive, incrementViolation, sessionViolations }) {
  const policyRef = useRef(createStrikePolicy());
  const lastFullscreenChangeRef = useRef(0);
  const [needsFullscreen, setNeedsFullscreen] = useState(false);
  const [showTabWarning, setShowTabWarning] = useState(false);
  const [violationInfo, setViolationInfo] = useState({
    titleKey: "",
    descriptionKey: "",
    imagePath: "",
    violationCount: 1,
    counts: true,
  });

  const { t } = useTranslation("interview");
  const tRef = useRef(t);

  const isWarningOpenRef = useRef(false);

  // Buffers an Electron hard-block that arrived before isActive was true.
  // Flushed by the effect below once the session loads.
  const pendingElectronViolationRef = useRef(null);

  const isActiveRef = useRef(isActive);
  const incrementViolationRef = useRef(incrementViolation);
  // Mirror the live violation count for warn-only modals that must NOT increment.
  const sessionViolationsRef = useRef(sessionViolations);

  // Keep the refs read by the once-registered listeners in sync with the latest
  // render values. Synced in an effect (not during render) so a discarded
  // concurrent render can't leave a stale value behind.
  useEffect(() => {
    isActiveRef.current = isActive;
    incrementViolationRef.current = incrementViolation;
    sessionViolationsRef.current = sessionViolations;
    tRef.current = t;
  });

  // Single entry point for raising a violation modal. Stable identity (reads live
  // values via refs) so the once-registered document listeners and the
  // AI/Electron handlers can all share it without re-binding.
  //
  // countsAsViolation=false → show the modal but DON'T add a strike (e.g. bottle,
  // multiple people): the displayed tally stays unchanged and it can't push the
  // candidate toward auto-termination.
  // Single gate for every violation, whatever raised it. Returns the outcome so
  // the AI loop knows whether its evidence was actually spent.
  const raiseViolation = useCallback(
    ({
      type,
      source,
      label,
      detail,
      titleKey,
      descriptionKey,
      imagePath,
      countsAsViolation = true,
    }) => {
      const key = type ?? titleKey;

      const report = (outcome, violationCount) => {
        recordViolationEvent({
          source,
          type: key,
          outcome,
          ...(label ? { label } : {}),
          ...(detail ?? {}),
          ...(violationCount === undefined ? {} : { violation_count: violationCount }),
        });
        return outcome;
      };

      if (!isActiveRef.current) return report("inactive");
      if (isWarningOpenRef.current) return report("modal_open");

      const outcome = policyRef.current.admit(key, { countsAsStrike: countsAsViolation });
      if (outcome !== "raised") return report(outcome);

      isWarningOpenRef.current = true;
      const violationCount = countsAsViolation
        ? incrementViolationRef.current()
        : sessionViolationsRef.current;

      // At the limit the session is already terminating, and TerminationNotice
      // owns the screen — showing a dismissible "return to interview" modal on
      // top of it would promise a way back that no longer exists. The ref has to
      // be released here or nothing ever clears it.
      if (countsAsViolation && violationCount >= MAX_VIOLATIONS) {
        isWarningOpenRef.current = false;
        return report("at_limit", violationCount);
      }

      setViolationInfo({
        titleKey,
        descriptionKey,
        imagePath,
        label,
        violationCount,
        counts: countsAsViolation,
      });
      setShowTabWarning(true);
      return report("raised", violationCount);
    },
    [],
  );

  // Auto-dismiss any open violation warning when session ends
  // (e.g., auto-submit triggered while a warning dialog was open)
  useEffect(() => {
    if (!isActive && showTabWarning) {
      isWarningOpenRef.current = false;
      // Deferred so the setState isn't a direct synchronous call in the effect body.
      queueMicrotask(() => setShowTabWarning(false));
    }
  }, [isActive, showTabWarning]);

  // memoized — prevents ViolationWarning re-renders on parent re-render
  const enterFullScreen = useCallback(() => {
    if (document.fullscreenElement) return;
    // Optional-chained because a browser that blocks or lacks the API would
    // otherwise throw here and take dismissWarning down with it.
    document.documentElement.requestFullscreen?.()?.catch((err) => {
      toast.error(`Error attempting to enable fullscreen: ${err.message}`);
    });
  }, []);

  // Reset the ref IMMEDIATELY, before enterFullScreen can re-trigger.
  const closeWarning = useCallback(() => {
    isWarningOpenRef.current = false;
    setShowTabWarning(false);
  }, []);

  const dismissWarning = useCallback(() => {
    closeWarning();
    setNeedsFullscreen(false);
    enterFullScreen();
  }, [closeWarning, enterFullScreen]);

  // requestFullscreen needs a user gesture, so the timer can only close the
  // modal — restoring fullscreen has to wait for a click.
  useEffect(() => {
    if (!showTabWarning) return;

    const timer = setTimeout(() => {
      closeWarning();
      policyRef.current.suppressFor(AUTO_DISMISS_GRACE_MS);
      if (!document.fullscreenElement) setNeedsFullscreen(true);
    }, AUTO_DISMISS_MS);

    return () => clearTimeout(timer);
  }, [showTabWarning, closeWarning]);

  const restoreFullscreen = useCallback(() => {
    setNeedsFullscreen(false);
    enterFullScreen();
  }, [enterFullScreen]);

  const handleAiViolation = useCallback(
    (violation) => {
      if (!isActiveRef.current) return;
      // Soft signals (looking away, blinking, low-confidence objects) are noisy
      // and must NOT count toward the strike-based auto-termination. Surface a
      // non-blocking nudge instead of the modal + strike.
      if (violation.soft) {
        toast.warning(tRef.current(violation.titleKey), {
          description: tRef.current(violation.descriptionKey),
        });
        return "soft";
      }
      return raiseViolation({
        type: violation.type,
        source: "ai",
        label: violation.label,
        detail: violation.detail,
        titleKey: violation.titleKey,
        descriptionKey: violation.descriptionKey,
        imagePath: violation.imagePath,
        // bottle / multiple people → modal only, no strike
        countsAsViolation: violation.countsAsViolation !== false,
      });
    },
    [raiseViolation],
  );

  const handleElectronViolation = useCallback(
    (violation) => {
      if (!isActiveRef.current) {
        // Session still loading — buffer and replay once isActive becomes true.
        pendingElectronViolationRef.current = violation;
        return "buffered";
      }
      return raiseViolation({
        type: `ELECTRON_${getElectronViolationKey(violation.event).toUpperCase()}`,
        source: "electron",
        ...electronViolationCopy(violation.event),
      });
    },
    [raiseViolation],
  );

  // Flush any violation that arrived before the session was ready.
  useEffect(() => {
    if (isActive && pendingElectronViolationRef.current) {
      const v = pendingElectronViolationRef.current;
      pendingElectronViolationRef.current = null;
      raiseViolation({
        type: `ELECTRON_${getElectronViolationKey(v.event).toUpperCase()}`,
        source: "electron",
        ...electronViolationCopy(v.event),
      });
    }
  }, [isActive, raiseViolation]);

  // Anti-cheat: disable right-click, copy, paste, cut
  useEffect(() => {
    const handleContextMenu = (e) => {
      e.preventDefault();
      toast.warning("Right-click is disabled during the interview.");
    };

    const handleCopyPaste = (e) => {
      e.preventDefault();
      toast.warning("Copying, pasting, or cutting is disabled during the interview.");
    };

    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("copy", handleCopyPaste);
    document.addEventListener("paste", handleCopyPaste);
    document.addEventListener("cut", handleCopyPaste);

    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("copy", handleCopyPaste);
      document.removeEventListener("paste", handleCopyPaste);
      document.removeEventListener("cut", handleCopyPaste);
    };
  }, []);

  //Anti-cheat listeners registered ONCE (dep array: []).
  // isActive and incrementViolation are read via isActiveRef / incrementViolationRef
  // so handlers always use current values without any re-registration on state change.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        raiseViolation({
          type: "TAB_SWITCH",
          source: "tab_switch",
          titleKey: "violations.tabSwitch.title",
          descriptionKey: "violations.tabSwitch.description",
          imagePath: "/window-switch.png",
        });
      }
    };

    const handleFullscreenChange = () => {
      lastFullscreenChangeRef.current = Date.now();
      if (!document.fullscreenElement) {
        raiseViolation({
          type: "FULLSCREEN_EXIT",
          source: "fullscreen_exit",
          titleKey: "violations.fullscreenExit.title",
          descriptionKey: "violations.fullscreenExit.description",
          imagePath: "/window-switch.png",
        });
      }
    };

    let resizeTimer = null;
    let confirmTimer = null;
    let lastPixelRatio = window.devicePixelRatio;

    const isWindowShrunk = () => {
      if (document.fullscreenElement) return false;
      return !(
        window.innerWidth >= screen.availWidth - RESIZE_TOLERANCE_PX &&
        window.innerHeight >= screen.availHeight - RESIZE_TOLERANCE_PX
      );
    };

    const handleResize = () => {
      // A DPI or browser-zoom change resizes the viewport without the user ever
      // touching the window, and must not read as un-maximizing.
      if (window.devicePixelRatio !== lastPixelRatio) {
        lastPixelRatio = window.devicePixelRatio;
        return;
      }

      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!isWindowShrunk()) return;
        // Monitor hotplug and OS window animations report a transient small size
        // before settling, so only a size that persists counts.
        if (confirmTimer) clearTimeout(confirmTimer);
        confirmTimer = setTimeout(() => {
          if (!isWindowShrunk()) return;
          if (Date.now() - lastFullscreenChangeRef.current < CASCADE_WINDOW_MS) return;
          raiseViolation({
            type: "WINDOW_RESIZE",
            source: "window_resize",
            titleKey: "violations.windowResize.title",
            descriptionKey: "violations.windowResize.description",
            imagePath: "/window-switch.png",
          });
        }, RESIZE_CONFIRM_MS);
      }, 300);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    window.addEventListener("resize", handleResize);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      window.removeEventListener("resize", handleResize);
      if (resizeTimer) clearTimeout(resizeTimer);
      if (confirmTimer) clearTimeout(confirmTimer);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // ↑ intentional empty deps — raiseViolation reads isActive/incrementViolation via refs

  return {
    showTabWarning,
    violationInfo,
    dismissWarning,
    needsFullscreen,
    restoreFullscreen,
    handleAiViolation,
    handleElectronViolation,
  };
}
