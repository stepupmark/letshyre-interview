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

// The warning only informs; the strike policy decides what counts. It still
// closes itself so it can't sit over the question for the rest of the interview.
const AUTO_DISMISS_MS = 20_000;

// An object or a switched-off camera is re-reported every few seconds while it
// lasts. Once reports stop for this long it is treated as gone.
export const HELD_TTL_MS = 12_000;

// Identity warnings run to their own limit and the next one may end the
// interview, so they always show, even over a warning already open.
const ALWAYS_SHOWN = new Set(["FACE_MISMATCH"]);

// Leaving fullscreen resizes the window, so the resize handler fires right
// behind fullscreenchange. Without this the candidate is struck twice for one
// action.
const CASCADE_WINDOW_MS = 2_000;

// Tab switches, fullscreen exits, resizes and focus loss are all one offence:
// leaving the interview. They share a strike key so one act strikes once, and
// each leave after coming back is a new incident that strikes straight away.
const LEFT_WINDOW = "LEFT_WINDOW";
// Brief focus blips (OS notifications, a stray click on the taskbar) are not a leave.
const FOCUS_CONFIRM_MS = 2_000;

let permissionPrompts = 0;

// A browser mic/camera prompt takes focus from the page, and answering it is
// not leaving the interview.
export async function whilePermissionPrompt(request) {
  permissionPrompts += 1;
  try {
    return await request;
  } finally {
    permissionPrompts -= 1;
  }
}

const STRIKES_KEY = "interview_strikes";

// Kept per session so a reload mid-interview doesn't drop the earlier strikes
// from the termination summary.
export function readStrikes(sessionId) {
  if (!sessionId) return [];
  try {
    const stored = JSON.parse(sessionStorage.getItem(`${STRIKES_KEY}:${sessionId}`));
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

function writeStrikes(sessionId, strikes) {
  if (!sessionId) return;
  try {
    sessionStorage.setItem(`${STRIKES_KEY}:${sessionId}`, JSON.stringify(strikes));
  } catch {
    // storage blocked: the summary still has this page's strikes
  }
}

export function getElectronViolationKey(event = "") {
  const e = event.toLowerCase();
  if (e.includes("hdmi") || e.includes("display")) return "externalDisplay";
  if (e.includes("mirror") || e.includes("sharing")) return "screenSharing";
  if (e.includes("agent") || e.includes("tamper")) return "securityMonitor";
  if (e.includes("minimize") || e.includes("close")) return "windowAction";
  return "generic";
}

// A second display or a mirrored screen is the same concern as a detected
// laptop; the rest are window-level actions.
const ELECTRON_IMAGES = {
  externalDisplay: "/laptop.png",
  screenSharing: "/laptop.png",
};

function electronViolation(event) {
  const key = getElectronViolationKey(event);
  return {
    type: `ELECTRON_${key.toUpperCase()}`,
    source: "electron",
    titleKey: `violations.electron.${key}.title`,
    descriptionKey: `violations.electron.${key}.description`,
    imagePath: ELECTRON_IMAGES[key] ?? "/window-switch.png",
  };
}

/**
 * Owns the violation-warning modal (state + raise/dismiss), the anti-cheat DOM
 * listeners that raise it (tab switch, fullscreen exit, window resize, focus
 * loss, copy/paste/right-click), and the Electron hard/soft-block bridge. Split
 * out of the interview page so that component stays focused on layout/rendering.
 */
export function useViolationMonitor({
  isActive,
  incrementViolation,
  sessionViolations,
  sessionId,
  onHardBlock,
}) {
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
  const [strikes, setStrikes] = useState([]);
  // Conditions still in view after their strike, and what else is going on
  // while a warning is open.
  const [heldViolations, setHeldViolations] = useState([]);
  const [alsoDetected, setAlsoDetected] = useState([]);

  const { t } = useTranslation("interview");
  const tRef = useRef(t);

  const isWarningOpenRef = useRef(false);
  const shownKeyRef = useRef(null);
  const heldRef = useRef(new Map());

  // Buffer Electron blocks that arrived before isActive was true. Flushed by the
  // effect below once the session loads.
  const pendingElectronViolationRef = useRef(null);
  const pendingHardBlockRef = useRef(false);

  // Strikes held back by the reaction window, one per strike key, landed in the
  // order they started once the window is over.
  const queueRef = useRef({ pending: new Map(), timer: null });
  const raiseRef = useRef(null);

  const isActiveRef = useRef(isActive);
  const incrementViolationRef = useRef(incrementViolation);
  // Mirror the live violation count for warn-only modals that must NOT increment.
  const sessionViolationsRef = useRef(sessionViolations);
  const sessionIdRef = useRef(sessionId);
  const onHardBlockRef = useRef(onHardBlock);

  // Keep the refs read by the once-registered listeners in sync with the latest
  // render values. Synced in an effect (not during render) so a discarded
  // concurrent render can't leave a stale value behind.
  useEffect(() => {
    isActiveRef.current = isActive;
    incrementViolationRef.current = incrementViolation;
    sessionViolationsRef.current = sessionViolations;
    sessionIdRef.current = sessionId;
    onHardBlockRef.current = onHardBlock;
    tRef.current = t;
  });

  const refreshAlsoDetected = useCallback(() => {
    const others = new Map();
    for (const [key, { violation }] of queueRef.current.pending) others.set(key, violation);
    for (const [key, { entry }] of heldRef.current) if (!others.has(key)) others.set(key, entry);
    others.delete(shownKeyRef.current);
    setAlsoDetected(
      [...others.values()].map(({ titleKey, label, labels }) => ({ titleKey, label, labels })),
    );
  }, []);

  const publishHeld = useCallback(() => {
    setHeldViolations([...heldRef.current.values()].map(({ entry }) => entry));
    refreshAlsoDetected();
  }, [refreshAlsoDetected]);

  const trackHeld = useCallback(
    (key, { titleKey, descriptionKey, label, labels }) => {
      const held = heldRef.current;
      const known = held.get(key);
      clearTimeout(known?.timer);
      const changed =
        !known ||
        known.entry.titleKey !== titleKey ||
        known.entry.label !== label ||
        String(known.entry.labels) !== String(labels);
      const entry = changed ? { key, titleKey, descriptionKey, label, labels } : known.entry;
      const timer = setTimeout(() => {
        held.delete(key);
        publishHeld();
      }, HELD_TTL_MS);
      held.set(key, { entry, timer });
      if (changed) publishHeld();
    },
    [publishHeld],
  );

  const clearHeld = useCallback(() => {
    for (const { timer } of heldRef.current.values()) clearTimeout(timer);
    heldRef.current.clear();
    setHeldViolations([]);
  }, []);

  const scheduleNext = useCallback(function schedule() {
    const queue = queueRef.current;
    if (queue.timer || !queue.pending.size) return;

    const wait = Math.max(0, policyRef.current.nextStrikeAt() - Date.now());
    queue.timer = setTimeout(() => {
      queue.timer = null;
      if (!isActiveRef.current) {
        queue.pending.clear();
        return;
      }
      const [[key, { violation }]] = [...queue.pending].sort(([, a], [, b]) => a.at - b.at);
      queue.pending.delete(key);
      raiseRef.current(violation, { replay: true });
      schedule();
    }, wait);
  }, []);

  // Single gate for every violation, whatever raised it. Returns the outcome so
  // the AI loop knows whether its evidence was actually spent.
  // countsAsViolation=false shows the modal without adding a strike. A strike
  // held back by the reaction window is queued and lands after it, even if the
  // condition has stopped by then: it was already confirmed.
  const raiseViolation = useCallback(
    (violation, { replay = false } = {}) => {
      const {
        type,
        strikeKey,
        source,
        label,
        labels,
        detail,
        titleKey,
        descriptionKey,
        imagePath,
        countsAsViolation = true,
        ongoing = false,
        incident = false,
        incidentStartedAt,
        restrikeAfterMs,
        maxRestrikes,
        remindWhileHeld = false,
        finalWarning,
      } = violation;
      const key = strikeKey ?? type ?? titleKey;

      const report = (outcome, violationCount, extra) => {
        recordViolationEvent({
          source,
          type: type ?? key,
          ...(strikeKey ? { strike_key: strikeKey } : {}),
          outcome,
          ...(label ? { label } : {}),
          ...(detail ?? {}),
          ...(violationCount === undefined ? {} : { violation_count: violationCount }),
          ...extra,
        });
        return outcome;
      };

      const show = (counts, violationCount) => {
        isWarningOpenRef.current = true;
        shownKeyRef.current = key;
        setViolationInfo({
          titleKey,
          descriptionKey,
          imagePath,
          label,
          labels,
          violationCount,
          counts,
          finalWarning,
        });
        setShowTabWarning(true);
        refreshAlsoDetected();
      };

      // An event trailing an act that already struck has nothing left to land.
      const queue = () => {
        if (!countsAsViolation) return false;
        if (incident && policyRef.current.struckSince(key, incidentStartedAt)) return false;
        const { pending } = queueRef.current;
        if (!pending.has(key)) pending.set(key, { violation, at: incidentStartedAt ?? Date.now() });
        refreshAlsoDetected();
        scheduleNext();
        return true;
      };

      if (!isActiveRef.current) return report("inactive");

      if (remindWhileHeld && countsAsViolation && titleKey) trackHeld(key, violation);

      if (ALWAYS_SHOWN.has(type)) {
        show(countsAsViolation, sessionViolationsRef.current);
        return report("raised");
      }

      // A warning that costs nothing never replaces the one on screen.
      if (isWarningOpenRef.current && !countsAsViolation) return report("modal_open");

      const outcome = policyRef.current.admit(key, {
        countsAsStrike: countsAsViolation,
        ongoing,
        incident,
        startedAt: incidentStartedAt,
        restrikeAfterMs,
        maxRestrikes,
        defer: !replay && queueRef.current.pending.size > 0,
      });

      if (outcome === "reaction_window" && queue()) {
        return report("queued", undefined, { held_back: outcome });
      }
      if (outcome !== "raised") return report(outcome);

      queueRef.current.pending.delete(key);
      const violationCount = countsAsViolation
        ? incrementViolationRef.current()
        : sessionViolationsRef.current;

      if (countsAsViolation && violationCount > 0) {
        const strike = {
          count: violationCount,
          at: Date.now(),
          titleKey,
          descriptionKey,
          imagePath,
          label,
          labels,
        };
        const all = [...readStrikes(sessionIdRef.current), strike];
        writeStrikes(sessionIdRef.current, all);
        setStrikes(all);
      }

      // At the limit the session is already terminating, and TerminationNotice
      // owns the screen — showing a dismissible "return to interview" modal on
      // top of it would promise a way back that no longer exists. The ref has to
      // be released here or nothing ever clears it.
      if (countsAsViolation && violationCount >= MAX_VIOLATIONS) {
        const held = queueRef.current;
        clearTimeout(held.timer);
        held.timer = null;
        held.pending.clear();
        isWarningOpenRef.current = false;
        shownKeyRef.current = null;
        setShowTabWarning(false);
        return report("at_limit", violationCount);
      }

      // A new strike replaces whatever warning is on screen.
      show(countsAsViolation, violationCount);
      scheduleNext();
      return report("raised", violationCount);
    },
    [refreshAlsoDetected, scheduleNext, trackHeld],
  );

  useEffect(() => {
    raiseRef.current = raiseViolation;
  }, [raiseViolation]);

  // Nothing held back may land once the session is over.
  useEffect(() => {
    const queue = queueRef.current;
    const drop = () => {
      clearTimeout(queue.timer);
      queue.timer = null;
      queue.pending.clear();
      clearHeld();
    };
    if (!isActive) drop();
    return drop;
  }, [isActive, clearHeld]);

  // Auto-dismiss any open violation warning when session ends
  // (e.g., auto-submit triggered while a warning dialog was open)
  useEffect(() => {
    if (!isActive && showTabWarning) {
      isWarningOpenRef.current = false;
      shownKeyRef.current = null;
      // Deferred so the setState isn't a direct synchronous call in the effect body.
      queueMicrotask(() => setShowTabWarning(false));
    }
  }, [isActive, showTabWarning]);

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
    shownKeyRef.current = null;
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
      if (!document.fullscreenElement) setNeedsFullscreen(true);
    }, AUTO_DISMISS_MS);

    return () => clearTimeout(timer);
  }, [showTabWarning, violationInfo, closeWarning]);

  const restoreFullscreen = useCallback(() => {
    setNeedsFullscreen(false);
    enterFullScreen();
  }, [enterFullScreen]);

  const handleAiViolation = useCallback(
    (violation) => {
      if (!isActiveRef.current) return;
      // Gaze and blinking are noisy, so they nudge rather than strike. A nudge
      // over an open warning is noise; the next frame brings it back if needed.
      if (violation.soft) {
        if (isWarningOpenRef.current) return "soft";
        toast.warning(tRef.current(violation.titleKey), {
          description: tRef.current(violation.descriptionKey),
        });
        return "soft";
      }
      return raiseViolation({
        type: violation.strikeKey ?? violation.key ?? violation.type,
        source: "ai",
        label: violation.label,
        labels: violation.labels,
        detail: violation.detail,
        ongoing: violation.ongoing,
        incident: violation.incident,
        incidentStartedAt: violation.incidentStartedAt,
        restrikeAfterMs: violation.restrikeAfterMs,
        maxRestrikes: violation.maxRestrikes,
        remindWhileHeld: violation.remindWhileHeld,
        titleKey: violation.titleKey,
        descriptionKey: violation.descriptionKey,
        imagePath: violation.imagePath,
        countsAsViolation: violation.countsAsViolation !== false,
        finalWarning: violation.finalWarning,
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
      return raiseViolation(electronViolation(violation.event));
    },
    [raiseViolation],
  );

  // A hard block ends the interview rather than adding a strike.
  const handleElectronHardBlock = useCallback((violation) => {
    const active = isActiveRef.current;
    recordViolationEvent({
      source: "electron",
      type: electronViolation(violation?.event).type,
      outcome: active ? "terminated" : "buffered",
      hard_block: true,
    });
    if (!active) {
      pendingHardBlockRef.current = true;
      return "buffered";
    }
    onHardBlockRef.current?.();
    return "terminated";
  }, []);

  // Flush anything that arrived before the session was ready.
  useEffect(() => {
    if (!isActive) return;
    if (pendingHardBlockRef.current) {
      pendingHardBlockRef.current = false;
      pendingElectronViolationRef.current = null;
      onHardBlockRef.current?.();
      return;
    }
    if (pendingElectronViolationRef.current) {
      const v = pendingElectronViolationRef.current;
      pendingElectronViolationRef.current = null;
      raiseViolation(electronViolation(v.event));
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
    // The current leave. It stays open while the candidate is away, and a leave
    // made while still on the page (a fullscreen exit, a resize) stays joinable
    // for the cascade window so the events one act fires strike once.
    let leftWindow = null;

    const leaveWindow = (violation, at = Date.now()) => {
      const away = document.hidden || !document.hasFocus();
      const joins = leftWindow && (leftWindow.away || at - leftWindow.lastAt < CASCADE_WINDOW_MS);
      leftWindow = joins
        ? {
            startedAt: leftWindow.startedAt,
            lastAt: Math.max(leftWindow.lastAt, at),
            away: leftWindow.away || away,
          }
        : { startedAt: at, lastAt: at, away };
      raiseViolation({
        ...violation,
        strikeKey: LEFT_WINDOW,
        incident: true,
        incidentStartedAt: leftWindow.startedAt,
        maxRestrikes: 0,
      });
    };

    const cameBack = () => {
      leftWindow = null;
    };

    let focusTimer = null;

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        if (document.hasFocus()) cameBack();
        return;
      }
      clearTimeout(focusTimer);
      leaveWindow({
        type: "TAB_SWITCH",
        source: "tab_switch",
        titleKey: "violations.tabSwitch.title",
        descriptionKey: "violations.tabSwitch.description",
        imagePath: "/window-switch.png",
      });
    };

    // Another app over a still-visible page never hides the tab, so focus is the
    // only sign the candidate left.
    const handleBlur = () => {
      if (document.hidden || permissionPrompts > 0) return;
      const leftAt = Date.now();
      clearTimeout(focusTimer);
      focusTimer = setTimeout(() => {
        focusTimer = null;
        if (document.hidden || document.hasFocus() || permissionPrompts > 0) return;
        leaveWindow(
          {
            type: "WINDOW_FOCUS",
            source: "window_focus",
            titleKey: "violations.windowFocus.title",
            descriptionKey: "violations.windowFocus.description",
            imagePath: "/window-switch.png",
          },
          leftAt,
        );
      }, FOCUS_CONFIRM_MS);
    };

    const handleFocus = () => {
      clearTimeout(focusTimer);
      focusTimer = null;
      if (!document.hidden) cameBack();
    };

    const handleFullscreenChange = () => {
      lastFullscreenChangeRef.current = Date.now();
      if (document.fullscreenElement) {
        // Chromium only: Esc then has to be held to leave fullscreen. The desktop
        // app locks every key so Alt+Tab and the Windows key stay in the page;
        // narrowing it to Escape here would undo that.
        navigator.keyboard?.lock?.(window.electronAPI ? undefined : ["Escape"])?.catch(() => {});
        return;
      }
      // Esc pressed while reading a warning drops fullscreen without leaving the
      // page, and closing the warning restores it.
      if (isWarningOpenRef.current && !document.hidden && document.hasFocus()) return;
      leaveWindow({
        type: "FULLSCREEN_EXIT",
        source: "fullscreen_exit",
        titleKey: "violations.fullscreenExit.title",
        descriptionKey: "violations.fullscreenExit.description",
        imagePath: "/window-switch.png",
      });
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
          leaveWindow({
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
    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
      if (resizeTimer) clearTimeout(resizeTimer);
      if (confirmTimer) clearTimeout(confirmTimer);
      clearTimeout(focusTimer);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // ↑ intentional empty deps — raiseViolation reads isActive/incrementViolation via refs

  return {
    showTabWarning,
    violationInfo,
    alsoDetected,
    heldViolations,
    strikes,
    dismissWarning,
    needsFullscreen,
    restoreFullscreen,
    handleAiViolation,
    handleElectronViolation,
    handleElectronHardBlock,
  };
}
