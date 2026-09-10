import { useEffect, useRef, useState } from "react";
import { detectFrame, submitProctoringLogs } from "@/services/proctoring.api";
import { captureFrameBase64 } from "@/lib/videoCapture";
import { createViolationStabilizer } from "@/lib/violationStabilizer";
import { createBaselineTracker } from "@/lib/baselineTracker";
import { PROHIBIT_LAPTOP, SHADOW_LABELS } from "@/config/interview";
import { recordViolationEvent, subscribeToViolationLog } from "@/lib/violationLog";
import { logger } from "@/lib/logger";

const DETECT_INTERVAL_MS = 5_000;
const IMAGE_QUALITY = 0.7;
const TARGET_WIDTH = 640;
const TARGET_HEIGHT = 480;

// Hammering a struggling AI service at full rate makes it worse.
const MAX_BACKOFF_MS = 40_000;
const DEGRADED_AFTER_FAILURES = 3;

// A hard violation pulls the next couple of samples in close so it resolves in
// about a second instead of waiting out the full interval. At 5s spacing a phone
// held for five seconds lands in one frame and never reaches a second.
const BURST_INTERVAL_MS = 1_000;
const BURST_SAMPLES = 2;
const BURST_TYPES = new Set(["PROHIBITED_OBJECT", "NO_FACE", "MULTIPLE_FACES"]);

// fetch(keepalive) caps the body at 64KB. Oldest records are dropped first so a
// too-large tail degrades to a partial log instead of no log at all.
const KEEPALIVE_BODY_LIMIT = 60_000;

/**
 * Last-chance delivery during page unload.
 *
 * navigator.sendBeacon cannot set an Authorization header, so the endpoint
 * rejects it — fetch with keepalive survives unload AND keeps the header, and
 * sendBeacon remains only as a fallback where keepalive is unsupported.
 */
export function sendUnloadFlush(url, payload) {
  const accessToken = sessionStorage.getItem("ac");

  let body = JSON.stringify(payload);
  if (body.length > KEEPALIVE_BODY_LIMIT) {
    const records = payload.payload.records;
    let kept = records;
    while (kept.length > 1 && body.length > KEEPALIVE_BODY_LIMIT) {
      kept = kept.slice(Math.ceil(kept.length / 10));
      body = JSON.stringify({
        ...payload,
        payload: { total_records: kept.length, records: kept, truncated: true },
      });
    }
    logger.warn(
      `[Proctoring] ✂️ Unload payload trimmed to ${kept.length}/${records.length} records.`,
    );
  }

  try {
    void fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body,
      keepalive: true,
    });
  } catch {
    navigator.sendBeacon?.(url, body);
  }
}

// Per class, because YOLO confidence is not comparable across labels or object
// sizes. The area floor drops sub-pixel boxes without touching real detections.
const PROHIBITED_OBJECTS = {
  "cell phone": { minConfidence: 0.5, minAreaRatio: 0.004 },
  laptop: { minConfidence: 0.6, minAreaRatio: 0.005 },
  book: { minConfidence: 0.55, minAreaRatio: 0.01 },
  tablet: { minConfidence: 0.5, minAreaRatio: 0.01 },
};

// Confidence on a murky frame is worth less than the same number on a clean
// one, so the floor rises as quality drops. A box covering a good chunk of the
// frame is unambiguous either way and skips the penalty.
const QUALITY_REFERENCE = 0.5;
const QUALITY_PENALTY = 0.3;
const AREA_OVERRIDE_RATIO = 0.05;

function ruleFor(label) {
  if (label === "laptop" && !PROHIBIT_LAPTOP) return null;
  return PROHIBITED_OBJECTS[label] ?? null;
}

export function confidenceFloorFor(rule, object, frameQuality) {
  if ((object?.area_ratio ?? 0) >= AREA_OVERRIDE_RATIO) return rule.minConfidence;
  if (typeof frameQuality !== "number") return rule.minConfidence;

  const deficit = Math.max(0, QUALITY_REFERENCE - frameQuality);
  return Math.min(0.95, rule.minConfidence + deficit * QUALITY_PENALTY);
}

export function findProhibitedObjects(result) {
  return (result?.objects_detected || []).filter((object) => {
    const rule = ruleFor(object?.label?.toLowerCase());
    if (!rule) return false;

    // Payloads without a score fall back to label-only matching rather than
    // silently dropping every object detection.
    const confidence = object.confidence ?? object.score;
    const floor = confidenceFloorFor(rule, object, result?.frame_quality);
    if (confidence !== undefined && confidence < floor) return false;

    const area = object.area_ratio;
    if (area !== undefined && area < rule.minAreaRatio) return false;

    return true;
  });
}

/**
 * Analyses the AI detection response and returns a violation object if found.
 * Returns null if everything is clean.
 *
 * `classified` carries the baseline/introduced verdict from the tracker. Without
 * it every prohibited object counts as introduced, which is what the detection
 * tests want.
 *
 * Priority order: no face → multiple faces → prohibited object → not looking
 */
export function detectViolation(result, classified) {
  if (!result?.success) return null;

  if (!result.face_detected) {
    return {
      type: "NO_FACE",
      titleKey: "violations.noFace.title",
      descriptionKey: "violations.noFace.description",
      imagePath: "/no-candidate.png",
    };
  }

  // Show the warning modal but DON'T count it as a strike.
  if (result.face_count > 1) {
    return {
      type: "MULTIPLE_FACES",
      titleKey: "violations.multipleFaces.title",
      descriptionKey: "violations.multipleFaces.description",
      imagePath: "/multi-people.png",
      countsAsViolation: false,
    };
  }

  const objects =
    classified ?? findProhibitedObjects(result).map((object) => ({ object, state: "introduced" }));
  const strikeable = objects.find((entry) => entry.state !== "baseline");
  const environment = objects.find((entry) => entry.state === "baseline");
  const hit = strikeable || environment;

  if (hit) {
    return {
      type: strikeable ? "PROHIBITED_OBJECT" : "PROHIBITED_OBJECT_BASELINE",
      titleKey: "violations.prohibitedObject.title",
      descriptionKey: "violations.prohibitedObject.description",
      imagePath: "/laptop.png",
      label: hit.object.label,
      detection: hit.object,
      ...(strikeable ? {} : { countsAsViolation: false }),
    };
  }

  // Gaze and blinking are noisy — nudge, don't strike.
  if (result.looking_at_camera === false) {
    return {
      type: "NOT_LOOKING",
      titleKey: "violations.notLooking.title",
      descriptionKey: "violations.notLooking.description",
      imagePath: "/window-switch.png",
      soft: true,
    };
  }

  if (result.eyes_open === false) {
    return {
      type: "EYES_CLOSED",
      titleKey: "violations.eyesClosed.title",
      descriptionKey: "violations.eyesClosed.description",
      imagePath: "/window-switch.png",
      soft: true,
    };
  }

  return null;
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
  const queueRef = useRef([]);
  const timerRef = useRef(null);
  const busyRef = useRef(false);
  const hasFlushedRef = useRef(false); // set only on a CONFIRMED delivery
  const flushInFlightRef = useRef(false);
  const isActiveRef = useRef(false);
  const sessionRef = useRef({ interviewId, sessionId, proctoringToken });
  const onViolationRef = useRef(onViolation);
  const stabilizerRef = useRef(createViolationStabilizer());
  const baselineRef = useRef(createBaselineTracker());
  const consecutiveFailuresRef = useRef(0);
  const burstRemainingRef = useRef(0);

  const [isDegraded, setIsDegraded] = useState(false);

  useEffect(() => {
    sessionRef.current = { interviewId, sessionId, proctoringToken };
  }, [interviewId, sessionId, proctoringToken]);

  useEffect(() => {
    onViolationRef.current = onViolation;
  }, [onViolation]);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  useEffect(
    () =>
      subscribeToViolationLog((event) => {
        queueRef.current.push({
          timestamp: new Date().toISOString(),
          source: "cv_detect",
          event_type: "violation_decision",
          payload: event,
        });
      }),
    [],
  );

  // Shared util: aspect-preserving downscale into the target box (no stretch),
  // returns raw base64 (no data-URL prefix) or null if the camera isn't ready.
  function captureFrame() {
    return captureFrameBase64(videoRef.current, {
      maxWidth: TARGET_WIDTH,
      maxHeight: TARGET_HEIGHT,
      quality: IMAGE_QUALITY,
    });
  }

  // A gap in observation breaks the evidence chain, so a window can't span
  // frames we never actually saw.
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
      logger.warn(
        `[Proctoring] ⚠️ Detection degraded after ${consecutiveFailuresRef.current} failures.`,
      );
      setIsDegraded(true);
    }
  }

  function recordSuccess() {
    if (consecutiveFailuresRef.current === 0) return;
    consecutiveFailuresRef.current = 0;
    setIsDegraded(false);
  }

  // Why a violation did or didn't reach the candidate. Without this the batch
  // shows only what the camera saw, never what the client decided about it.
  function detectionDetail(violation, frameQuality) {
    const detection = violation.detection;
    if (!detection) return { frame_quality: frameQuality };

    return {
      label: detection.label,
      confidence: detection.confidence ?? detection.score,
      area_ratio: detection.area_ratio,
      frame_quality: frameQuality,
    };
  }

  // Outcomes the strike policy never sees, so they have to be logged here.
  function recordDecision(violation, outcome, frameQuality) {
    recordViolationEvent({
      source: "ai",
      type: violation.type,
      outcome,
      window: stabilizerRef.current.peek()[violation.type] ?? null,
      ...detectionDetail(violation, frameQuality),
    });
  }

  function dispatchViolation(violation, frameQuality) {
    const label = violation.detection?.label?.toLowerCase();
    if (label && SHADOW_LABELS.has(label)) {
      stabilizerRef.current.commit(violation.type);
      recordDecision(violation, "shadow", frameQuality);
      return;
    }

    // The monitor owns cooldowns and the strike floor for every source, and
    // reports back whether the evidence was actually spent.
    const outcome = onViolationRef.current?.({
      ...violation,
      detail: detectionDetail(violation, frameQuality),
    });

    if (outcome === "raised" || outcome === "at_limit") {
      stabilizerRef.current.commit(violation.type);
      logger.warn(`[Proctoring] 🚩 Violation raised: ${violation.type}`);
    }
  }

  async function tick() {
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

      queueRef.current.push({
        timestamp: new Date().toISOString(),
        source: "cv_detect",
        event_type: "frame",
        payload: cleanResult,
      });

      // Re-check isActive after the async AI call — session may have ended
      // (auto-submit, normal submit) while we were waiting for the response.
      const now = Date.now();
      const classified = baselineRef.current.classify(findProhibitedObjects(cleanResult), now);
      const detected = detectViolation(cleanResult, classified);
      const violation = stabilizerRef.current.push(detected);

      if (detected && BURST_TYPES.has(detected.type) && consecutiveFailuresRef.current === 0) {
        burstRemainingRef.current = BURST_SAMPLES;
      } else if (!detected) {
        burstRemainingRef.current = 0;
      }

      // Re-check isActive after the async call — the session may have ended
      // (auto-submit, normal submit) while we were waiting for the response.
      if (violation && isActiveRef.current) {
        dispatchViolation(violation, cleanResult.frame_quality);
      } else if (violation) {
        recordDecision(violation, "session_ended", cleanResult.frame_quality);
      } else if (detected) {
        recordDecision(detected, "unconfirmed", cleanResult.frame_quality);
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

    if (burstRemainingRef.current > 0) {
      burstRemainingRef.current -= 1;
      timerRef.current = setTimeout(tick, BURST_INTERVAL_MS);
      return;
    }

    const failures = consecutiveFailuresRef.current;
    const delay =
      failures === 0
        ? DETECT_INTERVAL_MS
        : Math.min(DETECT_INTERVAL_MS * 2 ** failures, MAX_BACKOFF_MS);
    timerRef.current = setTimeout(tick, delay);
  }

  const flushRetryCountRef = useRef(0);
  const MAX_FLUSH_RETRIES = 3;

  function buildFlushPayload() {
    const { interviewId: iid, sessionId: sid, proctoringToken: token } = sessionRef.current;
    if (!iid || !sid) return null;

    return {
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
  }

  async function flushQueue() {
    const { interviewId: iid, sessionId: sid, proctoringToken: token } = sessionRef.current;

    if (hasFlushedRef.current || flushInFlightRef.current) return;
    if (queueRef.current.length === 0) {
      logger.log("[Proctoring] 📭 No detection results to flush.");
      return;
    }
    if (!iid || !sid) {
      logger.warn("[Proctoring] ⚠️ Missing interview/session ID, cannot flush.");
      return;
    }

    // Only guards against a concurrent flush. hasFlushedRef is set on a
    // CONFIRMED delivery, so an exhausted retry budget still leaves the unload
    // path free to make a final attempt.
    flushInFlightRef.current = true;

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
      hasFlushedRef.current = true;
      logger.log("[Proctoring] ✅ Batch proctoring logs submitted successfully.");
    } catch (err) {
      logger.error("[Proctoring] ❌ Batch submission failed:", err?.response?.status, err?.message);
      flushRetryCountRef.current += 1;
      if (flushRetryCountRef.current < MAX_FLUSH_RETRIES) {
        logger.log(
          `[Proctoring] 🔄 Will retry flush when online (attempt ${flushRetryCountRef.current}/${MAX_FLUSH_RETRIES}).`,
        );
      } else {
        logger.warn(
          "[Proctoring] ⛔ Max flush retries reached. Logs will be retried on page unload.",
        );
      }
    } finally {
      flushInFlightRef.current = false;
    }
  }

  useEffect(() => {
    if (isActive) {
      logger.log("[Proctoring] ▶️ Interview active — starting detection loop.");
      hasFlushedRef.current = false;
      flushRetryCountRef.current = 0;
      stabilizerRef.current.reset();
      baselineRef.current.start(Date.now());
      consecutiveFailuresRef.current = 0;
      burstRemainingRef.current = 0;
      // Deferred so the setState isn't a direct synchronous call in the effect body.
      queueMicrotask(() => setIsDegraded(false));
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

  const prevActiveRef = useRef(false);
  useEffect(() => {
    if (prevActiveRef.current && !isActive) {
      flushQueue();
    }
    prevActiveRef.current = isActive;
  }, [isActive]);

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

  useEffect(() => {
    const onUnload = () => {
      if (queueRef.current.length === 0 || hasFlushedRef.current) return;

      const payload = buildFlushPayload();
      if (!payload) return;

      const baseUrl = import.meta.env.VITE_API_BASE_URL || "";
      sendUnloadFlush(`${baseUrl}/user/v1/candidate/interview/proctoring/log/`, payload);
      // Deliberately NOT marking flushed: an unload send cannot be confirmed,
      // so a surviving page must still be free to retry.
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
