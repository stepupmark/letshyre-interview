import { useEffect, useRef, useState } from "react";
import { detectFrame, submitProctoringLogs } from "@/services/proctoring.api";
import { captureFrameBase64 } from "@/lib/videoCapture";
import { createViolationStabilizer } from "@/lib/violationStabilizer";
import { logger } from "@/lib/logger";

const DETECT_INTERVAL_MS = 5_000; // capture every 5 seconds
const IMAGE_QUALITY = 0.7;
const TARGET_WIDTH = 640;
const TARGET_HEIGHT = 480;

// Detection is unreliable below this many consecutive failures, and hammering a
// struggling AI service at full rate makes it worse.
const MAX_BACKOFF_MS = 40_000;
const DEGRADED_AFTER_FAILURES = 3;

const VIOLATION_COOLDOWN_MS = 30_000;
// Floor between strikes of ANY type, so one bad moment producing two different
// violations can't burn two of the three allowed strikes in a few seconds.
const MIN_STRIKE_INTERVAL_MS = 15_000;

// "laptop" is deliberately absent: the candidate is sitting at one.
const PROHIBITED_OBJECTS = new Set(["cell phone", "book", "tablet"]);
const OBJECT_CONFIDENCE_THRESHOLD = 0.6;

function isProhibitedObject(obj) {
  if (!PROHIBITED_OBJECTS.has(obj?.label?.toLowerCase())) return false;
  // Payloads without a score fall back to label-only matching rather than
  // silently dropping every object detection.
  const confidence = obj.confidence ?? obj.score;
  return confidence === undefined || confidence >= OBJECT_CONFIDENCE_THRESHOLD;
}

/**
 * Analyses the AI detection response and returns a violation object if found.
 * Returns null if everything is clean.
 *
 * Priority order: no face → multiple faces → prohibited object → not looking at camera
 */
export function detectViolation(result) {
  if (!result?.success) return null;

  // 1. No face detected
  if (!result.face_detected) {
    return {
      type: "NO_FACE",
      title: "Candidate Not Detected",
      description:
        "Ensure you are properly positioned in front of the camera to avoid automatic termination.",
      imagePath: "/no-candidate.png",
    };
  }

  // 2. Multiple faces — show the warning modal but DON'T count it as a strike.
  if (result.face_count > 1) {
    return {
      type: "MULTIPLE_FACES",
      title: "Multiple People Detected",
      description:
        "Only you should be visible on the interview screen. Please ensure no one else is in view.",
      imagePath: "/multi-people.png",
      countsAsViolation: false,
    };
  }

  // 3. Prohibited objects (phone, book, tablet)
  const foundObject = (result.objects_detected || []).find(isProhibitedObject);
  if (foundObject) {
    return {
      type: "PROHIBITED_OBJECT",
      title: `${foundObject.label} Detected`,
      description: `Please put away all prohibited devices to continue the interview.`,
      imagePath: "/laptop.png",
    };
  }

  // 4. Not looking at camera (soft — gaze is noisy; nudge, don't strike).
  if (result.looking_at_camera === false) {
    return {
      type: "NOT_LOOKING",
      title: "Look at the Camera",
      description:
        "Please keep your eyes on the screen. Looking away repeatedly will be flagged as a violation.",
      imagePath: "/window-switch.png",
      soft: true,
    };
  }

  // 5. Eyes closed (soft — blinking would otherwise wrongly accrue strikes).
  if (result.eyes_open === false) {
    return {
      type: "EYES_CLOSED",
      title: "Eyes Closed Detected",
      description: "Please keep your eyes open and stay focused during the interview.",
      imagePath: "/window-switch.png",
      soft: true,
    };
  }

  return null; // All clear
}

/**
 * Proctoring system hook.
 *
 * While `isActive` is true:
 *   1. Captures a webcam frame every DETECT_INTERVAL_MS
 *   2. Sends it to the CV AI detection API
 *   3. Stores the AI response (without the base64 frame) in a local queue
 *
 * When the interview ends (isActive becomes false):
 *   - Sends ONE single POST to Django with all collected detection results
 *
 * Also flushes on page unload as a safety net.
 */
export function useProctoringSystem(
  videoRef,
  interviewId,
  sessionId,
  isActive,
  proctoringToken,
  onViolation,
) {
  // ── Refs (stable across renders, no dependency issues) ───────────────
  const queueRef = useRef([]); // collected AI detection results
  const timerRef = useRef(null); // setTimeout id
  const busyRef = useRef(false); // prevent overlapping detections
  const hasFlushedRef = useRef(false); // ensure we only flush once
  const isActiveRef = useRef(false); // mirror of isActive for use inside setTimeout
  const sessionRef = useRef({ interviewId, sessionId, proctoringToken });
  const onViolationRef = useRef(onViolation);
  const violationCooldownRef = useRef(new Map()); // prevent spamming the same warning
  const stabilizerRef = useRef(createViolationStabilizer());
  const consecutiveFailuresRef = useRef(0);
  const lastStrikeAtRef = useRef(0);

  const [isDegraded, setIsDegraded] = useState(false);

  // Keep session info in ref so the loop closure always has latest values
  useEffect(() => {
    sessionRef.current = { interviewId, sessionId, proctoringToken };
  }, [interviewId, sessionId, proctoringToken]);

  // Keep onViolation callback in ref
  useEffect(() => {
    onViolationRef.current = onViolation;
  }, [onViolation]);

  // Keep isActive mirrored in a ref
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  // ── Frame capture ────────────────────────────────────────────────────
  // Shared util: aspect-preserving downscale into the target box (no stretch),
  // returns raw base64 (no data-URL prefix) or null if the camera isn't ready.
  function captureFrame() {
    return captureFrameBase64(videoRef.current, {
      maxWidth: TARGET_WIDTH,
      maxHeight: TARGET_HEIGHT,
      quality: IMAGE_QUALITY,
    });
  }

  // A gap in observation breaks the consecutive-evidence chain, so a streak
  // can't span frames we never actually saw.
  function recordFailure(reason) {
    stabilizerRef.current.reset();
    consecutiveFailuresRef.current += 1;

    queueRef.current.push({
      timestamp: new Date().toISOString(),
      source: "cv_detect",
      event_type: "detection_failure",
      payload: { reason, consecutive: consecutiveFailuresRef.current },
    });

    if (consecutiveFailuresRef.current >= DEGRADED_AFTER_FAILURES) {
      logger.warn(`[Proctoring] ⚠️ Detection degraded after ${consecutiveFailuresRef.current} failures.`);
      setIsDegraded(true);
    }
  }

  function recordSuccess() {
    if (consecutiveFailuresRef.current === 0) return;
    consecutiveFailuresRef.current = 0;
    setIsDegraded(false);
  }

  // ── Single detection tick ────────────────────────────────────────────
  async function tick() {
    // Guard: don't run if interview stopped or already processing
    if (!isActiveRef.current || busyRef.current) {
      scheduleNext();
      return;
    }

    const frame = captureFrame();
    if (!frame) {
      logger.log("[Proctoring] 📸 Camera not ready, retrying in 1s…");
      timerRef.current = setTimeout(tick, 1000);
      return;
    }

    busyRef.current = true;

    try {
      // Step 5.2: Send frame to CV detection AI
      logger.log("[Proctoring] 🤖 Sending frame to AI detection API…");
      const aiResult = await detectFrame(frame);
      logger.log("[Proctoring] ✅ AI response received:", aiResult);

      // Strip any base64 frame the AI might echo back
      const cleanResult = { ...aiResult };
      delete cleanResult.frame;
      delete cleanResult.image;

      // An unsuccessful response carries no verdict — recording it as clean
      // would leave a stretch of log that looks observed but never was.
      if (!cleanResult.success) {
        recordFailure("unsuccessful_response");
        return;
      }
      recordSuccess();

      // Queue the detection result for batch submission later
      queueRef.current.push({
        timestamp: new Date().toISOString(),
        source: "cv_detect",
        event_type: "frame",
        payload: cleanResult,
      });

      // ── Check for violations and notify the UI ────────────────────
      // Re-check isActive after the async AI call — session may have ended
      // (auto-submit, normal submit) while we were waiting for the response.
      const detected = detectViolation(cleanResult);
      const violation = stabilizerRef.current.push(detected);
      logger.log(
        "[Proctoring] 🔍 detectViolation result:",
        detected?.type || "CLEAN",
        violation ? "(confirmed)" : "(unconfirmed)",
      );
      if (violation && isActiveRef.current) {
        const now = Date.now();
        const countsAsStrike = violation.countsAsViolation !== false && !violation.soft;
        const lastTime = violationCooldownRef.current.get(violation.type) || 0;
        const elapsed = now - lastTime;
        const sinceStrike = now - lastStrikeAtRef.current;

        if (elapsed <= VIOLATION_COOLDOWN_MS) {
          logger.log(
            `[Proctoring] ⏳ ${violation.type} in cooldown (${Math.round((VIOLATION_COOLDOWN_MS - elapsed) / 1000)}s remaining)`,
          );
        } else if (countsAsStrike && sinceStrike < MIN_STRIKE_INTERVAL_MS) {
          logger.log(
            `[Proctoring] ⏳ ${violation.type} held — ${Math.round((MIN_STRIKE_INTERVAL_MS - sinceStrike) / 1000)}s until the next strike is allowed`,
          );
        } else {
          violationCooldownRef.current.set(violation.type, now);
          if (countsAsStrike) lastStrikeAtRef.current = now;
          logger.warn(`[Proctoring] 🚩 Violation: ${violation.type} — calling onViolation`);
          onViolationRef.current?.(violation);
        }
      } else if (violation && !isActiveRef.current) {
        logger.log(
          `[Proctoring] ⛔ Violation ${violation.type} suppressed — session no longer active.`,
        );
      }
    } catch (err) {
      logger.error("[Proctoring] ❌ AI detection failed:", err?.response?.status, err?.message);
      recordFailure(err?.message || "request_failed");
    } finally {
      busyRef.current = false;
      scheduleNext();
    }
  }

  function scheduleNext() {
    if (!isActiveRef.current) return;
    const failures = consecutiveFailuresRef.current;
    const delay =
      failures === 0
        ? DETECT_INTERVAL_MS
        : Math.min(DETECT_INTERVAL_MS * 2 ** failures, MAX_BACKOFF_MS);
    timerRef.current = setTimeout(tick, delay);
  }

  // ── Batch flush (ONE call at end of interview) ───────────────────────
  const flushRetryCountRef = useRef(0);
  const MAX_FLUSH_RETRIES = 3;

  async function flushQueue() {
    const { interviewId: iid, sessionId: sid, proctoringToken: token } = sessionRef.current;

    if (hasFlushedRef.current) return;
    if (queueRef.current.length === 0) {
      logger.log("[Proctoring] 📭 No detection results to flush.");
      return;
    }
    if (!iid || !sid) {
      logger.warn("[Proctoring] ⚠️ Missing interview/session ID, cannot flush.");
      return;
    }

    hasFlushedRef.current = true; // Lock immediately to prevent double-flush

    const payload = {
      interview_id: iid,
      session_id: sid,
      proctoring_token: token,
      source: "cv_detect",
      event_type: "batch_proctoring_logs",
      payload: {
        total_records: queueRef.current.length,
        records: [...queueRef.current],
      },
    };

    try {
      logger.log(`[Proctoring] 🚀 Flushing ${queueRef.current.length} detection results…`);
      await submitProctoringLogs(payload);
      queueRef.current = [];
      flushRetryCountRef.current = 0;
      logger.log("[Proctoring] ✅ Batch proctoring logs submitted successfully.");
    } catch (err) {
      logger.error("[Proctoring] ❌ Batch submission failed:", err?.response?.status, err?.message);
      flushRetryCountRef.current += 1;
      // Allow retry if we haven't exceeded max retries (e.g. user was offline)
      if (flushRetryCountRef.current < MAX_FLUSH_RETRIES) {
        hasFlushedRef.current = false;
        logger.log(
          `[Proctoring] 🔄 Will retry flush when online (attempt ${flushRetryCountRef.current}/${MAX_FLUSH_RETRIES}).`,
        );
      } else {
        logger.warn(
          "[Proctoring] ⛔ Max flush retries reached. Logs will be sent via sendBeacon on page unload.",
        );
      }
    }
  }

  // ── Start / Stop loop based on isActive
  useEffect(() => {
    if (isActive) {
      logger.log("[Proctoring] ▶️ Interview active — starting detection loop.");
      hasFlushedRef.current = false;
      flushRetryCountRef.current = 0;
      stabilizerRef.current.reset();
      violationCooldownRef.current.clear();
      consecutiveFailuresRef.current = 0;
      lastStrikeAtRef.current = 0;
      // Deferred so the setState isn't a direct synchronous call in the effect body.
      queueMicrotask(() => setIsDegraded(false));
      // Start the first tick after a short delay
      timerRef.current = setTimeout(tick, DETECT_INTERVAL_MS);
    } else {
      logger.log("[Proctoring] ⏹️ Interview inactive — stopping loop.");
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isActive]); // Only depends on isActive — no callback deps!

  // ── Flush when interview transitions from active → inactive ──────────
  const prevActiveRef = useRef(false);
  useEffect(() => {
    if (prevActiveRef.current && !isActive) {
      flushQueue();
    }
    prevActiveRef.current = isActive;
  }, [isActive]);

  // ── Retry flush when internet comes back online ──────────────────────
  useEffect(() => {
    const handleOnlineFlush = () => {
      if (queueRef.current.length > 0 && !hasFlushedRef.current) {
        logger.log("[Proctoring] 🌐 Internet restored — retrying proctoring log flush...");
        flushQueue();
      }
    };

    window.addEventListener("online", handleOnlineFlush);
    return () => window.removeEventListener("online", handleOnlineFlush);
  }, []);

  // ── Safety net: flush on page unload ─────────────────────────────────
  useEffect(() => {
    const onUnload = () => {
      if (queueRef.current.length > 0 && !hasFlushedRef.current) {
        // Use sendBeacon for reliability on unload
        const { interviewId: iid, sessionId: sid, proctoringToken: token } = sessionRef.current;
        if (!iid || !sid) return;

        const payload = {
          interview_id: iid,
          session_id: sid,
          proctoring_token: token,
          source: "cv_detect",
          event_type: "batch_proctoring_logs",
          payload: {
            total_records: queueRef.current.length,
            records: [...queueRef.current],
          },
        };

        const baseUrl = import.meta.env.VITE_API_BASE_URL || "";
        const url = `${baseUrl}/user/v1/candidate/interview/proctoring/log/`;
        navigator.sendBeacon(url, JSON.stringify(payload));
        hasFlushedRef.current = true;
      }
    };

    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  return {
    flush: flushQueue,
    pendingCount: () => queueRef.current.length,
    isDegraded,
  };
}
