import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { MAX_VIOLATIONS } from "@/config/interview";

// Slack against OS chrome and DPI rounding when deciding whether the window is
// still maximized, and how long a shrunk window must persist before it counts.
const RESIZE_TOLERANCE_PX = 40;
const RESIZE_CONFIRM_MS = 1_000;

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
  const raiseViolation = useCallback(
    ({ titleKey, descriptionKey, imagePath, countsAsViolation = true }) => {
      if (!isActiveRef.current || isWarningOpenRef.current) return;
      isWarningOpenRef.current = true;
      const violationCount = countsAsViolation
        ? incrementViolationRef.current()
        : sessionViolationsRef.current;

      // At the limit the session is already terminating, and TerminationNotice
      // owns the screen — showing a dismissible "return to interview" modal on
      // top of it would promise a way back that no longer exists.
      if (countsAsViolation && violationCount >= MAX_VIOLATIONS) return;

      setViolationInfo({
        titleKey,
        descriptionKey,
        imagePath,
        violationCount,
        counts: countsAsViolation,
      });
      setShowTabWarning(true);
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

  //memoized — prevents ViolationWarning re-renders on parent re-render
  const enterFullScreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        toast.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    }
  }, []);

  // Dismiss violation warning — reset ref IMMEDIATELY before enterFullScreen can re-trigger
  const dismissWarning = useCallback(() => {
    isWarningOpenRef.current = false; // Reset FIRST
    setShowTabWarning(false);
    enterFullScreen();
  }, [enterFullScreen]);

  //AI Violation Handler
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
        return;
      }
      raiseViolation({
        titleKey: violation.titleKey,
        descriptionKey: violation.descriptionKey,
        imagePath: violation.imagePath,
        // bottle / multiple people → modal only, no strike
        countsAsViolation: violation.countsAsViolation !== false,
      });
    },
    [raiseViolation],
  );

  //Electron Security Bridge
  const handleElectronViolation = useCallback(
    (violation) => {
      if (!isActiveRef.current) {
        // Session still loading — buffer and replay once isActive becomes true.
        pendingElectronViolationRef.current = violation;
        return;
      }
      raiseViolation(electronViolationCopy(violation.event));
    },
    [raiseViolation],
  );

  // Flush any violation that arrived before the session was ready.
  useEffect(() => {
    if (isActive && pendingElectronViolationRef.current) {
      const v = pendingElectronViolationRef.current;
      pendingElectronViolationRef.current = null;
      raiseViolation(electronViolationCopy(v.event));
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
          titleKey: "violations.tabSwitch.title",
          descriptionKey: "violations.tabSwitch.description",
          imagePath: "/window-switch.png",
        });
      }
    };

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        raiseViolation({
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
          raiseViolation({
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
    handleAiViolation,
    handleElectronViolation,
  };
}
