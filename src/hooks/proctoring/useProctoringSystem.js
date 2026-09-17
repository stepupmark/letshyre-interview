import { useEffect, useRef, useState } from "react";
import { detectFrame, submitProctoringLogs } from "@/services/proctoring.api";
import { captureSample } from "@/lib/videoCapture";
import { violationCopy } from "@/lib/violationCopy";
import { createViolationStabilizer } from "@/lib/violationStabilizer";
import { createBaselineTracker } from "@/lib/baselineTracker";
import { createIncidentTracker } from "@/lib/incidentTracker";
import { OBJECT_CONFIDENCE_FLOOR, PROHIBIT_LAPTOP, SHADOW_LABELS } from "@/config/interview";
import { recordViolationEvent, subscribeToViolationLog } from "@/lib/violationLog";
import { logger } from "@/lib/logger";

const DETECT_INTERVAL_MS = 5_000;
const IMAGE_QUALITY = 0.7;
const TARGET_WIDTH = 640;
const TARGET_HEIGHT = 480;

// Hammering a struggling AI service at full rate makes it worse.
const MAX_BACKOFF_MS = 40_000;
const DEGRADED_AFTER_FAILURES = 3;

// A violation can appear and vanish between two 5s samples, so a candidate
// detection pulls the next couple in close and confirmation lands a second
// later instead of five. Soft signals are noisy and not worth the request rate.
const BURST_INTERVAL_MS = 1_000;
const BURST_SAMPLES = 2;
export const BURST_TYPES = new Set(["PROHIBITED_OBJECT", "MULTIPLE_FACES", "NO_FACE"]);

// Without a cap a phone left on the desk holds the loop at 1s for the rest of
// the interview, at five times the request rate.
const MAX_BURSTS = 3;

// The camera is usually a second or two behind the session starting, so the
// first few misses retry fast before falling back to the normal backoff.
const CAMERA_RETRY_MS = 1_000;
const CAMERA_GRACE_TICKS = 3;

// Past this much unobserved time a run of evidence counts as broken.
export const RESEED_AFTER_GAP_MS = 20_000;

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

// The area floor drops sub-pixel boxes without touching real detections, and
// maxBaselineAreaRatio stops something filling the lens from passing as
// furniture. Class ids are the 80-class COCO set the detector reports.
const PROHIBITED_OBJECTS = {
  // A phone is never part of the room, so it can't earn furniture status the
  // way a monitor or a bookshelf can.
  "cell phone": { classId: 67, canBaseline: false, minAreaRatio: 0.004 },
  laptop: { classId: 63, minAreaRatio: 0.005, maxBaselineAreaRatio: 0.25 },
  tv: { classId: 62, minAreaRatio: 0.01, maxBaselineAreaRatio: 0.25 },
  book: { classId: 73, minAreaRatio: 0.01, maxBaselineAreaRatio: 0.25 },
};

// class_id survives a model relabelling; the label string doesn't.
const LABEL_BY_CLASS_ID = new Map(
  Object.entries(PROHIBITED_OBJECTS).map(([label, rule]) => [rule.classId, label]),
);

export function canonicalLabel(object) {
  return LABEL_BY_CLASS_ID.get(object?.class_id) ?? object?.label?.toLowerCase() ?? null;
}

function ruleFor(object) {
  const label = canonicalLabel(object);
  if (!label) return null;
  if (label === "laptop" && !PROHIBIT_LAPTOP) return null;
  return PROHIBITED_OBJECTS[label] ?? null;
}

const ENVIRONMENT_STATES = new Set(["baseline", "pending"]);

export function applyBaselineRules(classified) {
  return classified.map((entry) => {
    if (!ENVIRONMENT_STATES.has(entry.state)) return entry;

    const rule = ruleFor(entry.object);
    if (!rule) return entry;

    const cap = rule.maxBaselineAreaRatio;
    const dominates = cap !== undefined && (entry.object?.area_ratio ?? 0) >= cap;

    return rule.canBaseline === false || dominates ? { ...entry, state: "introduced" } : entry;
  });
}

export function findProhibitedObjects(result) {
  return (result?.objects_detected || []).filter((object) => {
    const rule = ruleFor(object);
    if (!rule) return false;

    // Payloads without a score fall back to label-only matching rather than
    // silently dropping every object detection.
    const confidence = object.confidence ?? object.score;
    if (confidence !== undefined && confidence < OBJECT_CONFIDENCE_FLOOR) return false;

    const area = object.area_ratio;
    if (area !== undefined && area < rule.minAreaRatio) return false;

    return true;
  });
}

// Strikeable first, then the biggest and clearest box. Detector order is noise.
function compareDetections(a, b) {
  const rank = (entry) => (ENVIRONMENT_STATES.has(entry.state) ? 0 : 1);
  const area = (entry) => entry.object?.area_ratio ?? 0;
  const score = (entry) => entry.object?.confidence ?? entry.object?.score ?? 0;

  return rank(b) - rank(a) || area(b) - area(a) || score(b) - score(a);
}

// Two phones are one violation with a count, not two competing windows.
function groupByLabel(classified) {
  const groups = new Map();

  for (const entry of classified) {
    const label = canonicalLabel(entry.object);
    if (!label) continue;

    const group = groups.get(label);
    if (!group) {
      groups.set(label, { label, best: entry, count: 1 });
      continue;
    }

    group.count += 1;
    if (compareDetections(entry, group.best) < 0) group.best = entry;
  }

  return [...groups.values()];
}

function objectViolation({ label, best, count }) {
  const isEnvironment = ENVIRONMENT_STATES.has(best.state);

  return {
    type: "PROHIBITED_OBJECT",
    ...violationCopy("PROHIBITED_OBJECT"),
    key: `PROHIBITED_OBJECT:${label}`,
    state: best.state,
    label,
    count,
    detection: best.object,
    shadow: SHADOW_LABELS.has(label),
    incident: true,
    remindWhileHeld: true,
    ...(isEnvironment ? { countsAsViolation: false } : {}),
  };
}

/**
 * Every violation the frame shows, most severe first. Empty when it is clean.
 *
 * `classified` carries the baseline/introduced verdict from the tracker;
 * without it every prohibited object counts as introduced.
 *
 * Face presence gates everything below it. A frame with no face can't support
 * a claim about what the candidate is holding, so it reports the missing face
 * and leaves the object to the log.
 */
export function detectViolations(result, classified) {
  if (!result?.success) return [];

  // The face model misses people who are turned away or half out of frame, so
  // YOLO's person count gets a say too.
  const multiplePeople = result.face_count > 1 || result.yolo_person_count > 1;
  if (multiplePeople) {
    return [{ type: "MULTIPLE_FACES", ...violationCopy("MULTIPLE_FACES"), incident: true }];
  }

  if (!result.face_detected) {
    return [{ type: "NO_FACE", ...violationCopy("NO_FACE"), incident: true }];
  }

  const objects =
    classified ?? findProhibitedObjects(result).map((object) => ({ object, state: "introduced" }));

  // Stable sorts, so shadowed labels fall to the back without disturbing the
  // strikeable-first order among the rest.
  const violations = groupByLabel(objects)
    .sort((a, b) => compareDetections(a.best, b.best))
    .map(objectViolation)
    .sort((a, b) => Number(a.shadow) - Number(b.shadow));

  // Gaze and blinking are noisy — nudge, don't strike.
  if (result.looking_at_camera === false) {
    violations.push({ type: "NOT_LOOKING", ...violationCopy("NOT_LOOKING") });
  } else if (result.eyes_open === false) {
    violations.push({ type: "EYES_CLOSED", ...violationCopy("EYES_CLOSED") });
  }

  return violations;
}

/**
 * While `isActive` is true, samples the webcam every DETECT_INTERVAL_MS, sends
 * the frame to the CV detection API, hands the same sample to `onSample` for
 * face verification, and queues the response locally. The queue is flushed to
 * Django in one POST when the interview ends, and on unload as a safety net.
 */
export function useProctoringSystem(
  videoRef,
  interviewId,
  sessionId,
  isActive,
  proctoringToken,
  onViolation,
  onSample,
) {
  const queueRef = useRef([]);
  const timerRef = useRef(null);
  const busyRef = useRef(false);
  const hasFlushedRef = useRef(false); // set only on a CONFIRMED delivery
  const flushInFlightRef = useRef(false);
  const isActiveRef = useRef(false);
  const sessionRef = useRef({ interviewId, sessionId, proctoringToken });
  const onViolationRef = useRef(onViolation);
  const onSampleRef = useRef(onSample);
  const stabilizerRef = useRef(createViolationStabilizer());
  const baselineRef = useRef(createBaselineTracker());
  const consecutiveFailuresRef = useRef(0);
  const burstRemainingRef = useRef(0);
  const burstsUsedRef = useRef(0);
  const intervalRef = useRef(DETECT_INTERVAL_MS);
  const incidentsRef = useRef(createIncidentTracker());
  const struckIncidentsRef = useRef(new Map());

  const [isDegraded, setIsDegraded] = useState(false);

  useEffect(() => {
    sessionRef.current = { interviewId, sessionId, proctoringToken };
  }, [interviewId, sessionId, proctoringToken]);

  useEffect(() => {
    onViolationRef.current = onViolation;
  }, [onViolation]);

  useEffect(() => {
    onSampleRef.current = onSample;
  }, [onSample]);

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

  // This loop owns the only camera clock. Detection and face verification both
  // read the frame it produces, so their verdicts describe the same instant and
  // backoff and bursts apply to both.
  function captureFrame() {
    return captureSample(videoRef.current, {
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
      label: canonicalLabel(detection),
      confidence: detection.confidence ?? detection.score,
      area_ratio: detection.area_ratio,
      ...(violation.count > 1 ? { count: violation.count } : {}),
      frame_quality: frameQuality,
    };
  }

  // Outcomes the strike policy never sees, so they have to be logged here.
  function recordDecision(violation, outcome, frameQuality) {
    recordViolationEvent({
      source: "ai",
      type: violation.type,
      outcome,
      window: stabilizerRef.current.peek()[violation.key ?? violation.type] ?? null,
      ...(violation.state ? { state: violation.state } : {}),
      ...detectionDetail(violation, frameQuality),
    });
  }

  // Violations collapse per label, so without this the baseline/introduced
  // verdict on every other box is never recorded anywhere.
  function recordClassification(classified, result) {
    if (!classified.length) return;

    recordViolationEvent({
      source: "ai",
      type: "OBJECT_CLASSIFICATION",
      outcome: "observed",
      frame_quality: result.frame_quality,
      // The service's own verdict, kept alongside ours so the two can be
      // compared when tuning the floor.
      api_violations: result.violations ?? [],
      objects: classified.map((entry) => ({
        label: canonicalLabel(entry.object),
        state: entry.state,
        confidence: entry.object.confidence ?? entry.object.score,
        area_ratio: entry.object.area_ratio,
      })),
    });
  }

  // Only one violation per frame reaches the candidate, but a shadowed or
  // cooled-down one must not be what stops the rest from being considered.
  function dispatchViolations(confirmed, frameQuality, now) {
    let raised = false;

    for (const violation of confirmed) {
      const key = violation.key ?? violation.type;

      if (violation.shadow) {
        recordDecision(violation, "shadow", frameQuality);
        stabilizerRef.current.commit(key);
        continue;
      }

      if (raised) {
        recordDecision(violation, "deferred", frameQuality);
        continue;
      }

      // The monitor owns cooldowns and the strike floor for every source, and
      // reports back whether the evidence was actually spent.
      const startedAt = incidentsRef.current.startedAt(key);
      const outcome = onViolationRef.current?.({
        ...violation,
        ongoing: startedAt < now,
        incidentStartedAt: startedAt,
        detail: detectionDetail(violation, frameQuality),
      });

      if (outcome === "raised" || outcome === "at_limit" || outcome === "warned") {
        stabilizerRef.current.commit(key);
        struckIncidentsRef.current.set(key, startedAt);
        raised = true;
        logger.warn(`[Proctoring] 🚩 Violation raised: ${violation.type}`);
      }
    }
  }

  async function tick() {
    if (!isActiveRef.current || busyRef.current) {
      scheduleNext();
      return;
    }

    const sample = captureFrame();
    if (!sample) {
      recordFailure("camera_unavailable");
      if (consecutiveFailuresRef.current <= CAMERA_GRACE_TICKS) {
        timerRef.current = setTimeout(tick, CAMERA_RETRY_MS);
      } else {
        scheduleNext();
      }
      return;
    }

    busyRef.current = true;
    // Verification waits for detection so it only compares clear, single-face
    // frames. Both stay unknown when detection fails, so identity still runs.
    let faceCount;
    let faceConfidence;

    try {
      logger.log("[Proctoring] 🤖 Sending frame to AI detection API…");
      const aiResult = await detectFrame(sample.frame);
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
      faceCount = cleanResult.face_detected
        ? Math.max(cleanResult.face_count ?? 1, cleanResult.yolo_person_count ?? 0, 1)
        : 0;
      faceConfidence = cleanResult.confidence_score;

      queueRef.current.push({
        timestamp: new Date().toISOString(),
        source: "cv_detect",
        event_type: "frame",
        payload: cleanResult,
      });

      // The room is only baselined when the session starts. Re-seeding after an
      // outage handed out a fresh grace every time the connection dropped.
      const now = Date.now();

      const classified = applyBaselineRules(
        baselineRef.current.classify(findProhibitedObjects(cleanResult), now),
      );
      recordClassification(classified, cleanResult);

      const detected = detectViolations(cleanResult, classified);
      const confirmed = stabilizerRef.current.push(detected);
      incidentsRef.current.observe(
        detected.map((v) => v.key ?? v.type),
        now,
      );

      // A held phone often drops out of a single frame, so a miss lets the burst
      // finish instead of falling straight back to the slow cadence.
      const worthBursting = detected.some((violation) => BURST_TYPES.has(violation.type));
      if (worthBursting) {
        if (burstsUsedRef.current < MAX_BURSTS) {
          burstRemainingRef.current = BURST_SAMPLES;
          burstsUsedRef.current += 1;
        }
      } else if (!detected.length && burstRemainingRef.current === 0) {
        burstsUsedRef.current = 0;
      }

      // Re-check isActive after the async call — the session may have ended
      // (auto-submit, normal submit) while we were waiting for the response.
      if (isActiveRef.current) {
        dispatchViolations(confirmed, cleanResult.frame_quality, now);
      } else {
        for (const violation of confirmed) {
          recordDecision(violation, "session_ended", cleanResult.frame_quality);
        }
      }

      // A commit clears the window, so the same object right after its strike
      // would otherwise log as a fresh, unconfirmed sighting.
      const struck = struckIncidentsRef.current;
      for (const violation of detected) {
        if (confirmed.includes(violation)) continue;
        const key = violation.key ?? violation.type;
        const held = struck.has(key) && struck.get(key) === incidentsRef.current.startedAt(key);
        recordDecision(violation, held ? "held" : "unconfirmed", cleanResult.frame_quality);
      }
    } catch (err) {
      logger.error("[Proctoring] ❌ AI detection failed:", err?.response?.status, err?.message);
      recordFailure(err?.message || "request_failed");
    } finally {
      if (isActiveRef.current) {
        onSampleRef.current?.({
          ...sample,
          intervalMs: intervalRef.current,
          faceCount,
          faceConfidence,
        });
      }
      busyRef.current = false;
      scheduleNext();
    }
  }

  function scheduleNext() {
    if (!isActiveRef.current) return;

    if (burstRemainingRef.current > 0) {
      burstRemainingRef.current -= 1;
      intervalRef.current = BURST_INTERVAL_MS;
      timerRef.current = setTimeout(tick, BURST_INTERVAL_MS);
      return;
    }

    const failures = consecutiveFailuresRef.current;
    const delay =
      failures === 0
        ? DETECT_INTERVAL_MS
        : Math.min(DETECT_INTERVAL_MS * 2 ** failures, MAX_BACKOFF_MS);
    intervalRef.current = delay;
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
      burstsUsedRef.current = 0;
      incidentsRef.current.reset();
      struckIncidentsRef.current.clear();
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
