import { useCallback, useEffect, useRef, useState } from "react";
import { detectFrame, submitProctoringLogs } from "@/services/proctoring.api";
import { captureSample, isVideoReady } from "@/lib/videoCapture";
import { violationCopy } from "@/lib/violationCopy";
import { createViolationStabilizer } from "@/lib/violationStabilizer";
import { createBaselineTracker } from "@/lib/baselineTracker";
import { createIncidentTracker } from "@/lib/incidentTracker";
import {
  HELD_RESTRIKE_SECONDS,
  OBJECT_CONFIDENCE_FLOOR,
  PROHIBIT_LAPTOP,
  SHADOW_LABELS,
  SHADOW_RULES,
} from "@/config/interview";
import {
  recordCheckStats,
  recordViolationEvent,
  subscribeToViolationLog,
} from "@/lib/violationLog";
import { logger } from "@/lib/logger";
import { RUN_ID } from "@/lib/correlation";

const DETECT_INTERVAL_MS = 5_000;
const IMAGE_QUALITY = 0.7;
const TARGET_WIDTH = 640;
const TARGET_HEIGHT = 480;
const VERIFY_FILE_MAX_WIDTH = 960;
const VERIFY_FILE_QUALITY = 0.9;

// How long after capture a frame waits for face verification before it is
// decided on detection alone. A later answer still counts for identity.
const VERIFY_WAIT_MS = 3_000;

// Detection never answered for this frame, so only verification's faces count.
const VERIFY_ONLY_FRAME = { success: true, verify_only: true, objects_detected: [] };
const NO_ANSWER = { faces: null, verifyMs: null };

// Longer than this between two answered detections is logged as unwatched time.
const UNOBSERVED_AFTER_MS = 2 * DETECT_INTERVAL_MS;

// The backend keeps one log batch per interview, so it is sent once the ending
// has settled, or this long after the interview stopped if it never does.
export const LOG_SEND_FALLBACK_MS = 30_000;

// The next frame is timed from when this one was captured, so a slow answer
// doesn't stretch the interval; this is the least gap left between two.
const MIN_TICK_GAP_MS = 250;

// Exponential backoff ceiling for AI service failures.
const MAX_BACKOFF_MS = 40_000;
const DEGRADED_AFTER_FAILURES = 3;

// Burst sampling interval and window for confirming transient detections.
const BURST_INTERVAL_MS = 1_000;
const BURST_SAMPLES = 2;
export const BURST_TYPES = new Set(["PROHIBITED_OBJECT", "MULTIPLE_FACES", "NO_FACE"]);

// Quick looks one incident may use. NO_FACE gets enough to reach its strike at 7s.
const MAX_BURSTS = 4;
const MAX_NO_FACE_BURSTS = 9;

// Multi-tiered NO_FACE escalation thresholds
export const NO_FACE_SILENT_GRACE_MS = 3_000;
export const NO_FACE_SOFT_GUIDANCE_MS = 7_000;

// The camera is usually a second or two behind the session starting, so the
// first few misses retry fast before falling back to the normal backoff.
const CAMERA_RETRY_MS = 1_000;
const CAMERA_GRACE_TICKS = 3;

// The camera itself going away, as opposed to the AI service failing, which
// only ever degrades. Checked on its own clock so failure backoff can't stretch it.
export const CAMERA_OFF_AFTER_MS = 10_000;
export const CAMERA_OFF_HINT_MS = 1_000;
const CAMERA_CHECK_MS = 1_000;

// A faint phone or laptop, or a look away, samples faster for a while so a
// quick glance at a phone can't fall between two 5s checks.
export const SUSPICION_CONFIDENCE_FLOOR = 0.2;
export const SUSPICION_INTERVAL_MS = 2_000;
export const SUSPICION_WINDOW_MS = 20_000;
const SUSPICIOUS_LABELS = new Set(["cell phone", "laptop"]);

// On-device watches ("local_*" reasons) can flicker, so they get at most one
// immediate check per gap.
export const LOCAL_TRIGGER_GAP_MS = 1_500;

// Looking away for 15s straight, or on 4 separate occasions in 2 minutes.
// Typing means looking at the keyboard, so a recent keypress resets the streak.
export const LOOKING_AWAY_HOLD_MS = 15_000;
export const LOOKING_AWAY_REPEATS = 4;
export const LOOKING_AWAY_WINDOW_MS = 120_000;
export const TYPING_GRACE_MS = 3_000;

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
// Phones and laptops are never part of the room, so neither earns furniture
// grace. A clear phone is often on screen for one frame, so it strikes on one.
const PROHIBITED_OBJECTS = {
  "cell phone": { classId: 67, canBaseline: false, minAreaRatio: 0.004, instantConfidence: 0.6 },
  laptop: { classId: 63, canBaseline: false, minAreaRatio: 0.005 },
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

// Every object in view shares one incident: one strike when they appear, and
// one more if they are still there HELD_RESTRIKE_SECONDS later.
export const OBJECT_INCIDENT = "PROHIBITED_OBJECT";
export const HELD_OBJECT_RESTRIKE_MS = HELD_RESTRIKE_SECONDS * 1000;

function objectViolation({ label, best, count }) {
  const isEnvironment = ENVIRONMENT_STATES.has(best.state);
  const instantAt = PROHIBITED_OBJECTS[label]?.instantConfidence;
  const confidence = best.object?.confidence ?? best.object?.score ?? 0;

  const copy = violationCopy("PROHIBITED_OBJECT", label) ?? violationCopy("PROHIBITED_OBJECT");

  return {
    type: "PROHIBITED_OBJECT",
    ...copy,
    key: `PROHIBITED_OBJECT:${label}`,
    state: best.state,
    label,
    count,
    detection: best.object,
    shadow: SHADOW_LABELS.has(label),
    incident: true,
    remindWhileHeld: true,
    ...(isEnvironment
      ? { countsAsViolation: false }
      : {
          instant: instantAt !== undefined && confidence >= instantAt,
          restrikeAfterMs: HELD_OBJECT_RESTRIKE_MS,
          maxRestrikes: 1,
        }),
  };
}

const isStrikeableObject = (violation) =>
  violation.type === OBJECT_INCIDENT && !violation.shadow && violation.countsAsViolation !== false;

export const incidentKeyOf = (violation) =>
  isStrikeableObject(violation) ? OBJECT_INCIDENT : (violation.key ?? violation.type);

// A phone and a laptop confirming together are one act, so they strike once and
// the warning names both.
export function mergeObjectViolations(confirmed) {
  const objects = confirmed.filter(isStrikeableObject);
  if (objects.length < 2) return confirmed;

  const merged = {
    ...objects[0],
    ...violationCopy("MULTIPLE_OBJECTS"),
    labels: objects.map((violation) => violation.label),
    keys: objects.map((violation) => violation.key),
  };
  return confirmed.flatMap((violation) =>
    violation === objects[0] ? [merged] : objects.includes(violation) ? [] : [violation],
  );
}

export const MULTIPLE_FACES_SCALE_THRESHOLD = 0.25;

export function getDetectionArea(item) {
  if (!item) return 0;
  if (
    typeof item.area_ratio === "number" &&
    !Number.isNaN(item.area_ratio) &&
    item.area_ratio > 0
  ) {
    return item.area_ratio;
  }
  if (typeof item.area === "number" && !Number.isNaN(item.area) && item.area > 0) {
    return item.area;
  }
  if (Array.isArray(item.bbox) && item.bbox.length === 4) {
    const [x1, y1, x2, y2] = item.bbox.map(Number);
    if (!Number.isNaN(x1) && !Number.isNaN(y1) && !Number.isNaN(x2) && !Number.isNaN(y2)) {
      return Math.abs((x2 - x1) * (y2 - y1));
    }
  }
  if (Array.isArray(item.box) && item.box.length === 4) {
    const [x1, y1, x2, y2] = item.box.map(Number);
    if (!Number.isNaN(x1) && !Number.isNaN(y1) && !Number.isNaN(x2) && !Number.isNaN(y2)) {
      return Math.abs((x2 - x1) * (y2 - y1));
    }
  }
  if (item.bbox && typeof item.bbox === "object") {
    const width = Number(item.bbox.width ?? 0);
    const height = Number(item.bbox.height ?? 0);
    if (!Number.isNaN(width) && !Number.isNaN(height)) {
      return Math.abs(width * height);
    }
  }
  return 0;
}

export function hasMultipleSignificantPeople(result) {
  if (!result) return false;

  // 1. Check face bounding boxes / detections if available
  const faceList = result.faces ?? result.faces_detected ?? result.face_details;
  let evaluatedFaceSpatial = false;
  if (Array.isArray(faceList) && faceList.length > 1) {
    const areas = faceList
      .map(getDetectionArea)
      .filter((a) => a > 0)
      .sort((a, b) => b - a);
    if (areas.length > 1) {
      evaluatedFaceSpatial = true;
      const primaryArea = areas[0];
      const hasSignificantSecondary = areas
        .slice(1)
        .some((area) => area / primaryArea >= MULTIPLE_FACES_SCALE_THRESHOLD);
      if (hasSignificantSecondary) return true;
    }
  }

  // 2. Check person bounding boxes in objects_detected or persons
  const personObjects = (result.objects_detected ?? []).filter(
    (o) => o.label?.toLowerCase() === "person" || o.class_id === 0,
  );
  const personList = Array.isArray(result.persons) ? result.persons : personObjects;
  let evaluatedPersonSpatial = false;
  if (personList.length > 1) {
    const areas = personList
      .map(getDetectionArea)
      .filter((a) => a > 0)
      .sort((a, b) => b - a);
    if (areas.length > 1) {
      evaluatedPersonSpatial = true;
      const primaryArea = areas[0];
      const hasSignificantSecondary = areas
        .slice(1)
        .some((area) => area / primaryArea >= MULTIPLE_FACES_SCALE_THRESHOLD);
      if (hasSignificantSecondary) return true;
    }
  }

  // 3. If explicit spatial detections were provided and evaluated, do not fall back to raw counts
  if (evaluatedFaceSpatial || evaluatedPersonSpatial) {
    return false;
  }

  // 4. Fallback for payloads with only scalar counts or without spatial data
  return (result.face_count ?? 0) > 1 || (result.yolo_person_count ?? 0) > 1;
}

// The count identity vetting sees. A small figure in the background (a poster,
// a TV) is not a second person, so it doesn't make the frame unvetted.
export function faceCountOf(result) {
  if (!result.face_detected) return 0;
  return hasMultipleSignificantPeople(result) ? 2 : 1;
}

// Verification misses faces in a dim room. When detection and the device both
// see one, its "none" is logged but doesn't count.
export const verifyOutvoted = (result) =>
  result.verified_faces === "none" &&
  !result.verify_only &&
  !!result.face_detected &&
  result.face_count !== 0 &&
  (result.local_faces === "one" || result.local_faces === "multiple");

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

  // `verified_faces` is what face verification saw on the same frame. Either
  // check seeing the problem is enough, and `seenBy` records which one did.
  // A `verify_only` frame is one detection never answered for.
  const verified = result.verified_faces;
  const faceViolation = (type, byDetect, byVerify) => ({
    type,
    ...violationCopy(type),
    incident: true,
    ...(verified ? { seenBy: byDetect && byVerify ? "both" : byVerify ? "verify" : "detect" } : {}),
  });

  const manyByDetect = !result.verify_only && hasMultipleSignificantPeople(result);
  if (manyByDetect || verified === "multiple") {
    return [faceViolation("MULTIPLE_FACES", manyByDetect, verified === "multiple")];
  }

  // Detection misses a face half hidden behind a phone. Verification finding
  // one on the same frame means someone is there, so the phone still counts.
  const noneByDetect =
    !result.verify_only && (!result.face_detected || result.face_count === 0) && verified !== "one";
  const noneByVerify = verified === "none" && !verifyOutvoted(result);
  if (noneByDetect || noneByVerify) {
    return [faceViolation("NO_FACE", noneByDetect, noneByVerify)];
  }

  if (result.verify_only) return [];

  const objects =
    classified ?? findProhibitedObjects(result).map((object) => ({ object, state: "introduced" }));

  // Stable sorts: strikeable first, shadowed labels at the end
  const objectViolations = groupByLabel(objects)
    .sort((a, b) => compareDetections(a.best, b.best))
    .map(objectViolation)
    .sort((a, b) => Number(a.shadow) - Number(b.shadow));

  const violations = [...objectViolations];

  // Soft-warning only for gaze and eye-closure events when candidate is visible alone.
  if (!result.face_detected) return violations;
  if (result.looking_at_camera === false) {
    violations.push({ type: "NOT_LOOKING", ...violationCopy("NOT_LOOKING") });
  } else if (result.eyes_open === false) {
    violations.push({ type: "EYES_CLOSED", ...violationCopy("EYES_CLOSED") });
  }

  return violations;
}

// Why the next few samples should come faster, or null. Never a violation itself.
export function suspicionReason(result, detected, { typing = false } = {}) {
  for (const object of result?.objects_detected || []) {
    const label = canonicalLabel(object);
    const confidence = object.confidence ?? object.score;
    if (
      SUSPICIOUS_LABELS.has(label) &&
      ruleFor(object) &&
      !SHADOW_LABELS.has(label) &&
      confidence >= SUSPICION_CONFIDENCE_FLOOR &&
      confidence < OBJECT_CONFIDENCE_FLOOR
    ) {
      return `faint_object:${label}`;
    }
  }

  // Looking down while typing is expected and would keep sampling fast all session.
  if (!typing && detected.some((violation) => violation.type === "NOT_LOOKING")) {
    return "not_looking";
  }
  return null;
}

// Only the camera device's own state. A frame the AI service could not judge
// says nothing about whether the camera is still there.
export function cameraOffReason(video, hasPlayed) {
  const tracks = video?.srcObject?.getVideoTracks?.();
  if (tracks && !tracks.some((track) => track.readyState === "live" && !track.muted)) {
    return tracks.some((track) => track.muted) ? "track_muted" : "track_ended";
  }
  // Before the first frame this is the camera still starting, not going away.
  if (hasPlayed && video && !isVideoReady(video)) return "no_frames";
  return null;
}

export function createGazeTracker({
  holdMs = LOOKING_AWAY_HOLD_MS,
  repeats = LOOKING_AWAY_REPEATS,
  windowMs = LOOKING_AWAY_WINDOW_MS,
} = {}) {
  let awaySince = null;
  let countedStreak = null;
  let lapses = [];
  let settledAt = -Infinity;

  return {
    // One lapse per confirmed streak, so a single long look away can't also
    // satisfy the repeat rule on its own.
    observe({ away, confirmed = false, typing = false }, now) {
      lapses = lapses.filter((at) => now - at < windowMs);
      if (!away || typing) {
        awaySince = null;
        return null;
      }

      awaySince ??= now;
      if (confirmed && countedStreak !== awaySince) {
        countedStreak = awaySince;
        lapses.push(now);
      }

      if (awaySince > settledAt && now - awaySince >= holdMs) {
        return { startedAt: awaySince, reason: "held" };
      }
      if (lapses.length >= repeats) return { startedAt: lapses[0], reason: "repeated" };
      return null;
    },

    // Called once the episode has struck or been shadow-logged, so the streak
    // behind it can't raise it again.
    settle(now) {
      settledAt = now;
      lapses = [];
    },

    interrupt() {
      awaySince = null;
    },

    reset() {
      awaySince = null;
      countedStreak = null;
      lapses = [];
      settledAt = -Infinity;
    },
  };
}

function lookingAwayViolation({ startedAt, reason }) {
  return {
    type: "LOOKING_AWAY",
    ...violationCopy("LOOKING_AWAY"),
    reason,
    shadow: SHADOW_RULES.has("gaze"),
    incident: true,
    incidentStartedAt: startedAt,
    maxRestrikes: 0,
  };
}

/**
 * While `isActive` is true, samples the webcam every DETECT_INTERVAL_MS, sends
 * the frame to the CV detection API while handing the same sample to
 * `onSample` for face verification, and queues the response locally. The
 * queue is flushed to Django in one POST when the interview ends, and on
 * unload as a safety net.
 *
 * `localFacesRef.current` is the on-device face count ("none", "one",
 * "multiple" or null). An empty seat isn't sent for verification.
 */
export function useProctoringSystem(
  videoRef,
  interviewId,
  sessionId,
  isActive,
  proctoringToken,
  onViolation,
  onSample,
  logReady = true,
  localFacesRef,
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
  const serviceFailuresRef = useRef(0);
  const burstRemainingRef = useRef(0);
  const burstsUsedRef = useRef(new Map());
  const nextTickAtRef = useRef(0);
  const identityTimerRef = useRef(null);
  const identityRunRef = useRef(0);
  const incidentsRef = useRef(createIncidentTracker());
  const struckIncidentsRef = useRef(new Map());
  const lastNoFaceGuidanceRef = useRef(0);
  const suspicionUntilRef = useRef(0);
  const gazeRef = useRef(createGazeTracker());
  const lastKeyAtRef = useRef(-Infinity);
  const cameraRef = useRef({ hasPlayed: false, offSince: null, lastRaisedAt: -Infinity });
  const triggerRef = useRef("scheduled");
  const soonRef = useRef(null);
  const lastLocalAtRef = useRef(-Infinity);
  const lastObservedAtRef = useRef(null);

  const [isDegraded, setIsDegraded] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);

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
      fileMaxWidth: VERIFY_FILE_MAX_WIDTH,
      fileQuality: VERIFY_FILE_QUALITY,
    });
  }

  // A gap in observation breaks the evidence chain, so a window can't span
  // frames we never actually saw.
  function recordFailure(reason) {
    stabilizerRef.current.reset();
    gazeRef.current.interrupt();
    consecutiveFailuresRef.current += 1;

    queueRef.current.push({
      timestamp: new Date().toISOString(),
      source: "cv_detect",
      event_type: "detection_failure",
      payload: { reason, consecutive: consecutiveFailuresRef.current },
    });

    // A camera that is still starting is not the service being down, and a
    // camera that goes away is raised as CAMERA_OFF on its own clock.
    if (reason === "camera_unavailable") return;
    serviceFailuresRef.current += 1;
    if (serviceFailuresRef.current >= DEGRADED_AFTER_FAILURES) {
      logger.error(
        `[Proctoring] ⚠️ Detection degraded after ${serviceFailuresRef.current} failures (${reason}).`,
      );
      setIsDegraded(true);
    }
  }

  function recordSuccess() {
    if (consecutiveFailuresRef.current === 0) return;
    consecutiveFailuresRef.current = 0;
    serviceFailuresRef.current = 0;
    setIsDegraded(false);
  }

  // Why a violation did or didn't reach the candidate. Without this the batch
  // shows only what the camera saw, never what the client decided about it.
  function detectionDetail(violation, frameQuality) {
    const detection = violation.detection;
    if (!detection) {
      return {
        ...(violation.reason ? { reason: violation.reason } : {}),
        ...(violation.seenBy ? { seen_by: violation.seenBy } : {}),
        frame_quality: frameQuality,
      };
    }

    return {
      label: canonicalLabel(detection),
      ...(violation.labels ? { labels: violation.labels } : {}),
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
  // Returns the one that was raised, if any.
  function dispatchViolations(confirmed, frameQuality, now) {
    let raised = null;

    for (const violation of mergeObjectViolations(confirmed)) {
      const key = violation.key ?? violation.type;
      const incidentKey = incidentKeyOf(violation);

      if (violation.shadow) {
        recordDecision(violation, "shadow", frameQuality);
        stabilizerRef.current.commit(key);
        continue;
      }

      if (raised) {
        recordDecision(violation, "deferred", frameQuality);
        continue;
      }

      const startedAt = violation.incidentStartedAt ?? incidentsRef.current.startedAt(incidentKey);
      const absenceDuration = startedAt !== undefined ? now - startedAt : 0;

      // Multi-tiered NO_FACE escalation:
      // 0–3s: Silent grace window (allows candidate to look down at notes or scratchpad without strikes)
      // 3–7s: Soft visual guidance / HUD warning ("Please keep your face centered in frame") without issuing a punitive strike
      // >7s: Formal proctoring strike admission
      if (violation.type === "NO_FACE") {
        if (absenceDuration < NO_FACE_SILENT_GRACE_MS) {
          recordDecision(violation, "grace", frameQuality);
          continue;
        }

        if (absenceDuration <= NO_FACE_SOFT_GUIDANCE_MS) {
          if (now - lastNoFaceGuidanceRef.current >= 4_000) {
            lastNoFaceGuidanceRef.current = now;
            onViolationRef.current?.({
              ...violation,
              soft: true,
              countsAsViolation: false,
              strikeKey: incidentKey,
              ongoing: true,
              incidentStartedAt: startedAt,
              titleKey: "violations.noFaceGuidance.title",
              descriptionKey: "violations.noFaceGuidance.description",
              detail: detectionDetail(violation, frameQuality),
            });
          }
          recordDecision(violation, "guidance", frameQuality);
          continue;
        }
      }

      // Past 7s for NO_FACE, or any other confirmed violation:
      const outcome = onViolationRef.current?.({
        ...violation,
        strikeKey: incidentKey,
        ongoing: startedAt < now,
        incidentStartedAt: startedAt,
        detail: detectionDetail(violation, frameQuality),
      });

      if (outcome === "raised" || outcome === "at_limit" || outcome === "queued") {
        for (const committed of violation.keys ?? [key]) {
          stabilizerRef.current.commit(committed);
          struckIncidentsRef.current.set(committed, startedAt);
        }
        raised = violation;
        logger.warn(`[Proctoring] 🚩 Violation raised: ${violation.type}`);
      } else if (outcome === "soft") {
        recordDecision(violation, "hint", frameQuality);
      }
    }

    return raised;
  }

  async function tick() {
    stopIdentityChecks();
    const trigger = triggerRef.current;
    if (!isActiveRef.current || busyRef.current) {
      scheduleNext();
      return;
    }

    const sample = captureFrame();
    if (!sample) {
      recordFailure("camera_unavailable");
      if (consecutiveFailuresRef.current <= CAMERA_GRACE_TICKS) {
        setTickTimer(CAMERA_RETRY_MS, "camera_retry");
      } else {
        scheduleNext();
      }
      return;
    }

    busyRef.current = true;
    if (trigger.startsWith("local_")) lastLocalAtRef.current = sample.capturedAt;
    const localFaces = localFacesRef?.current ?? null;
    const detecting = detect(sample);
    // An empty seat isn't sent, but verification still has to see the gap so
    // the next mismatch gets its re-check.
    const verifying =
      localFaces === "none"
        ? verifyFaces({ ...sample, faceCount: 0 }, null)
        : verifyFaces(sample, detecting);

    try {
      const { result, detectMs } = await detecting;
      recordCheckStats({
        at: sample.capturedAt,
        detectMs,
        unobservedMs: result ? observedAt(sample.capturedAt) : 0,
      });

      const { faces, verifyMs } = await verifying;
      const frame = result ?? (faces ? VERIFY_ONLY_FRAME : null);
      if (frame) {
        const seen = {
          ...frame,
          ...(faces ? { verified_faces: faces } : {}),
          ...(localFacesRef ? { local_faces: localFaces } : {}),
        };
        processFrame(seen, sample.capturedAt, {
          trigger,
          detect_ms: detectMs,
          verify_ms: verifyMs,
          ...(localFacesRef ? { local_faces: localFaces } : {}),
        });
      }
    } catch (err) {
      logger.error("[Proctoring] ❌ Frame processing failed:", err?.message);
    } finally {
      busyRef.current = false;
      scheduleNext(sample.capturedAt);
    }
  }

  async function detect(sample) {
    const startedAt = Date.now();
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
      if (cleanResult.success) {
        recordSuccess();
        return { result: cleanResult, detectMs: Date.now() - startedAt };
      }
      recordFailure("unsuccessful_response");
    } catch (err) {
      logger.error("[Proctoring] ❌ AI detection failed:", err?.response?.status, err?.message);
      recordFailure(err?.message || "request_failed");
    }
    return { result: null, detectMs: null };
  }

  // Returns how long nothing was watched before this answer, when that gap is
  // longer than the loop ever leaves on purpose.
  function observedAt(at) {
    const last = lastObservedAtRef.current;
    lastObservedAtRef.current = at;
    return last !== null && at - last > UNOBSERVED_AFTER_MS ? at - last : 0;
  }

  // Verification sees the same frame, and the faces it saw join detection's
  // before anything is decided, so one person in view can't strike twice. It
  // runs alongside detection and gets detection's view of the frame as a
  // promise, so it still only compares clear frames; both stay unknown when
  // detection fails, so identity still runs.
  async function verifyFaces(sample, detecting) {
    if (!isActiveRef.current || !onSampleRef.current) return NO_ANSWER;
    const answering = Promise.resolve(
      onSampleRef.current({
        ...sample,
        detection: detecting?.then(({ result }) => ({
          faceCount: result ? faceCountOf(result) : undefined,
          faceConfidence: result?.confidence_score,
        })),
      }),
    ).then(
      (answer) => {
        if (!answer) return NO_ANSWER;
        const verifyMs = answer.verifyMs ?? null;
        recordCheckStats({ verifyMs });
        return { faces: answer.faces ?? null, verifyMs };
      },
      () => NO_ANSWER,
    );

    let timer;
    const answer = await Promise.race([
      answering,
      new Promise((resolve) => {
        timer = setTimeout(
          () => resolve(NO_ANSWER),
          sample.capturedAt + VERIFY_WAIT_MS - Date.now(),
        );
      }),
    ]);
    clearTimeout(timer);
    return answer;
  }

  function processFrame(frame, capturedAt, check) {
    const now = capturedAt ?? Date.now();
    const verifyOnly = frame.verify_only === true;

    queueRef.current.push({
      timestamp: new Date().toISOString(),
      source: "cv_detect",
      event_type: verifyOnly ? "verified_frame" : "frame",
      payload: {
        ...(verifyOnly ? { verified_faces: frame.verified_faces } : frame),
        captured_at: new Date(now).toISOString(),
        ...check,
      },
    });

    // The room is only baselined when the session starts. Re-seeding after an
    // outage handed out a fresh grace every time the connection dropped.
    const classified = verifyOnly
      ? []
      : applyBaselineRules(baselineRef.current.classify(findProhibitedObjects(frame), now));
    if (!verifyOnly) recordClassification(classified, frame);

    let detected = detectViolations(frame, classified);
    // Muted: what only verification saw is logged, never counted.
    if (SHADOW_RULES.has("verify_faces") && detected.some((v) => v.seenBy === "verify")) {
      for (const violation of detected) recordDecision(violation, "shadow", frame.frame_quality);
      detected = detectViolations({ ...frame, verified_faces: undefined }, classified);
    }
    if (verifyOutvoted(frame)) {
      recordDecision({ type: "NO_FACE", seenBy: "verify" }, "outvoted", frame.frame_quality);
    }
    if (!detected.some((violation) => violation.type === "NO_FACE")) {
      lastNoFaceGuidanceRef.current = 0;
    }
    const confirmed = stabilizerRef.current.push(detected);
    incidentsRef.current.observe(detected.map(incidentKeyOf), now);

    // Verification says nothing about gaze or objects, so those wait for detection.
    const typing = now - lastKeyAtRef.current < TYPING_GRACE_MS;
    const isNotLooking = (violation) => violation.type === "NOT_LOOKING";
    const lookingAway =
      !verifyOnly &&
      gazeRef.current.observe(
        { away: detected.some(isNotLooking), confirmed: confirmed.some(isNotLooking), typing },
        now,
      );

    const suspicion = !verifyOnly && suspicionReason(frame, detected, { typing });
    if (suspicion) {
      if (now >= suspicionUntilRef.current) {
        logger.log(`[Proctoring] 🔎 Sampling every ${SUSPICION_INTERVAL_MS}ms: ${suspicion}`);
        queueRef.current.push({
          timestamp: new Date().toISOString(),
          source: "cv_detect",
          event_type: "suspicion_sampling",
          payload: { reason: suspicion },
        });
      }
      suspicionUntilRef.current = now + SUSPICION_WINDOW_MS;
    }

    // Re-check isActive after the async call — the session may have ended
    // (auto-submit, normal submit) while we were waiting for the response.
    if (isActiveRef.current) {
      const gaze = lookingAway && lookingAwayViolation(lookingAway);
      // Ahead of the soft gaze toast, so the strike isn't shown alongside it.
      const queue = gaze
        ? [...confirmed.filter((v) => !v.soft), gaze, ...confirmed.filter((v) => v.soft)]
        : confirmed;
      const raised = dispatchViolations(queue, frame.frame_quality, now);
      if (gaze && (gaze.shadow || raised === gaze)) gazeRef.current.settle(now);
    } else {
      for (const violation of confirmed) {
        recordDecision(violation, "session_ended", frame.frame_quality);
      }
    }

    // A commit clears the window, so the same object right after its strike
    // would otherwise log as a fresh, unconfirmed sighting.
    const struck = struckIncidentsRef.current;
    // Per label, so a phone joining a laptop that already struck is still new evidence.
    const isHeld = (violation) => {
      const key = violation.key ?? violation.type;
      return (
        struck.has(key) &&
        struck.get(key) === incidentsRef.current.startedAt(incidentKeyOf(violation))
      );
    };
    for (const violation of detected) {
      if (confirmed.includes(violation)) continue;
      const held = isHeld(violation);
      recordDecision(violation, held ? "held" : "unconfirmed", frame.frame_quality);
      // Shadow only: measures whether confirming on one frame both checks agree on is safe.
      if (!held && violation.type === "MULTIPLE_FACES" && violation.seenBy === "both") {
        recordDecision(violation, "would_confirm_now", frame.frame_quality);
      }
    }

    // Only evidence still waiting to confirm earns a quick second look. A muted
    // or already struck laptop used to spend the whole budget, so a phone shown
    // later never got one. Not while detection is down: its backoff comes first.
    // Each incident has its own budget, so one that used it up can't leave the
    // next without quick looks.
    const burstable = verifyOnly
      ? []
      : detected.filter(
          (violation) =>
            BURST_TYPES.has(violation.type) &&
            !violation.shadow &&
            violation.countsAsViolation !== false &&
            (!confirmed.includes(violation) || violation.type === "NO_FACE") &&
            !isHeld(violation),
        );
    const used = burstsUsedRef.current;
    const budgetKey = (violation) => {
      const key = incidentKeyOf(violation);
      return `${key}@${incidentsRef.current.startedAt(key)}`;
    };
    const next = burstable.find(
      (violation) =>
        (used.get(budgetKey(violation)) ?? 0) <
        (violation.type === "NO_FACE" ? MAX_NO_FACE_BURSTS : MAX_BURSTS),
    );
    if (next) {
      const key = budgetKey(next);
      used.set(key, (used.get(key) ?? 0) + 1);
      burstRemainingRef.current = BURST_SAMPLES;
    } else if (!burstable.length && burstRemainingRef.current === 0) {
      used.clear();
    }

    setHasChecked(true);
  }

  // `trigger` is logged with the frame, so each check says why it ran when it did.
  function setTickTimer(delay, trigger) {
    clearTimeout(timerRef.current);
    triggerRef.current = trigger;
    nextTickAtRef.current = Date.now() + delay;
    timerRef.current = setTimeout(() => tickRef.current(), delay);
  }

  function scheduleNext(capturedAt) {
    if (!isActiveRef.current) return;
    const now = Date.now();
    const spent = capturedAt ? now - capturedAt : 0;
    const failures = consecutiveFailuresRef.current;

    let interval = DETECT_INTERVAL_MS;
    let trigger = "scheduled";
    if (burstRemainingRef.current > 0) {
      burstRemainingRef.current -= 1;
      interval = BURST_INTERVAL_MS;
      trigger = "burst";
    } else if (failures > 0) {
      interval = Math.min(DETECT_INTERVAL_MS * 2 ** failures, MAX_BACKOFF_MS);
      trigger = "backoff";
    } else if (now < suspicionUntilRef.current) {
      interval = SUSPICION_INTERVAL_MS;
      trigger = "suspicion";
    }
    let delay = Math.max(MIN_TICK_GAP_MS, interval - spent);

    // A quicker look asked for while this tick was running.
    const soon = busyRef.current ? null : soonRef.current;
    if (soon) {
      soonRef.current = null;
      if (failures === 0 && soon.at - now < delay) {
        delay = Math.max(MIN_TICK_GAP_MS, soon.at - now);
        trigger = soon.reason;
      }
    }

    setTickTimer(delay, trigger);
    if (interval > DETECT_INTERVAL_MS) scheduleIdentityChecks();
  }

  // Backing off protects the detection service, but it would slow identity
  // checks down with it. Frames captured for identity alone keep their pace.
  function scheduleIdentityChecks() {
    stopIdentityChecks();
    const run = identityRunRef.current;
    const check = async () => {
      if (!isActiveRef.current || busyRef.current) return;
      const sample = captureFrame();
      if (sample) {
        recordCheckStats({ at: sample.capturedAt });
        const { faces, verifyMs } = await verifyFaces(sample, null);
        if (run !== identityRunRef.current) return;
        if (faces && isActiveRef.current) {
          processFrame({ ...VERIFY_ONLY_FRAME, verified_faces: faces }, sample.capturedAt, {
            trigger: "backoff",
            detect_ms: null,
            verify_ms: verifyMs,
            ...(localFacesRef ? { local_faces: localFacesRef.current ?? null } : {}),
          });
        }
      }
      identityTimerRef.current = setTimeout(check, DETECT_INTERVAL_MS);
    };
    identityTimerRef.current = setTimeout(check, DETECT_INTERVAL_MS);
  }

  // A tick owns the camera again, including checks still waiting on an answer.
  function stopIdentityChecks() {
    clearTimeout(identityTimerRef.current);
    identityRunRef.current += 1;
  }

  // Face verification asks for a quicker next look after a mismatch or while
  // the face is unclear, and the on-device watches for an immediate one when
  // what they see changes. Backoff still wins: the service is struggling then.
  function sampleSoon(reason, delayMs = SUSPICION_INTERVAL_MS) {
    if (!isActiveRef.current) return;
    const now = Date.now();
    // The device seeing a change is a reason to look, not evidence, so it
    // doesn't keep the faster pace going afterwards.
    const onDevice = reason?.startsWith("local_");
    if (onDevice) {
      delayMs = Math.max(delayMs, lastLocalAtRef.current + LOCAL_TRIGGER_GAP_MS - now);
    } else {
      if (now >= suspicionUntilRef.current) {
        logger.log(`[Proctoring] 🔎 Sampling every ${SUSPICION_INTERVAL_MS}ms: ${reason}`);
        queueRef.current.push({
          timestamp: new Date().toISOString(),
          source: "cv_detect",
          event_type: "suspicion_sampling",
          payload: { reason },
        });
      }
      suspicionUntilRef.current = now + SUSPICION_WINDOW_MS;
    }
    if (consecutiveFailuresRef.current > 0) return;

    // Verification asks from inside a tick, which takes it up when it
    // schedules the next one.
    const at = now + delayMs;
    if (busyRef.current) {
      if (!soonRef.current || at < soonRef.current.at) soonRef.current = { at, reason };
    } else if (nextTickAtRef.current > at) {
      setTickTimer(delayMs, reason);
    }
  }

  function checkCamera() {
    const now = Date.now();
    const state = cameraRef.current;
    const video = videoRef.current;
    if (isVideoReady(video)) state.hasPlayed = true;

    const reason = cameraOffReason(video, state.hasPlayed);
    if (!reason) {
      if (state.offSince !== null) {
        logger.log("[Proctoring] 📷 Camera is back.");
        recordViolationEvent({
          source: "camera",
          type: "CAMERA_OFF",
          outcome: "recovered",
          off_for_ms: now - state.offSince,
        });
      }
      state.offSince = null;
      return;
    }

    if (state.offSince === null) {
      state.offSince = now;
      state.hinted = false;
      logger.warn(`[Proctoring] 📷 Camera unavailable: ${reason}`);
      recordViolationEvent({ source: "camera", type: "CAMERA_OFF", outcome: "started", reason });
    }
    // Tell the candidate early, long before it costs a strike.
    if (!state.hinted && now - state.offSince >= CAMERA_OFF_HINT_MS) {
      state.hinted = true;
      onViolationRef.current?.({
        type: "CAMERA_OFF",
        ...violationCopy("CAMERA_OFF_HINT"),
        soft: true,
        countsAsViolation: false,
      });
      recordViolationEvent({
        source: "camera",
        type: "CAMERA_OFF",
        outcome: "hint",
        reason,
        off_for_ms: now - state.offSince,
      });
    }
    if (now - state.offSince <= CAMERA_OFF_AFTER_MS) return;
    // Paced like a detection tick so a held incident reminds rather than spams the log.
    if (now - state.lastRaisedAt < DETECT_INTERVAL_MS) return;
    state.lastRaisedAt = now;

    onViolationRef.current?.({
      type: "CAMERA_OFF",
      ...violationCopy("CAMERA_OFF"),
      strikeKey: "CAMERA_OFF",
      incident: true,
      remindWhileHeld: true,
      restrikeAfterMs: HELD_OBJECT_RESTRIKE_MS,
      maxRestrikes: 1,
      ongoing: true,
      incidentStartedAt: state.offSince,
      detail: { reason, off_for_ms: now - state.offSince },
    });
  }

  const flushRetryCountRef = useRef(0);
  const MAX_FLUSH_RETRIES = 3;

  function buildFlushPayload() {
    const { interviewId: iid, sessionId: sid, proctoringToken: token } = sessionRef.current;
    if (!iid || !sid) return null;

    return {
      interview_id: iid,
      session_id: sid,
      run_id: RUN_ID,
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
    if (hasFlushedRef.current || flushInFlightRef.current) return;
    if (queueRef.current.length === 0) {
      logger.log("[Proctoring] 📭 No detection results to flush.");
      return;
    }
    const payload = buildFlushPayload();
    if (!payload) {
      logger.warn("[Proctoring] ⚠️ Missing interview/session ID, cannot flush.");
      return;
    }

    // Only guards against a concurrent flush. hasFlushedRef is set on a
    // CONFIRMED delivery, so an exhausted retry budget still leaves the unload
    // path free to make a final attempt.
    flushInFlightRef.current = true;

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

  const tickRef = useRef(tick);
  const checkCameraRef = useRef(checkCamera);
  const sampleSoonRef = useRef(sampleSoon);
  useEffect(() => {
    tickRef.current = tick;
    checkCameraRef.current = checkCamera;
    sampleSoonRef.current = sampleSoon;
  });
  const requestSample = useCallback(
    (reason, delayMs) => sampleSoonRef.current(reason, delayMs),
    [],
  );

  useEffect(() => {
    if (isActive) {
      logger.log("[Proctoring] ▶️ Interview active — starting detection loop.");
      hasFlushedRef.current = false;
      flushRetryCountRef.current = 0;
      stabilizerRef.current.reset();
      baselineRef.current.start(Date.now());
      consecutiveFailuresRef.current = 0;
      serviceFailuresRef.current = 0;
      burstRemainingRef.current = 0;
      burstsUsedRef.current.clear();
      incidentsRef.current.reset();
      struckIncidentsRef.current.clear();
      lastNoFaceGuidanceRef.current = 0;
      suspicionUntilRef.current = 0;
      soonRef.current = null;
      lastLocalAtRef.current = -Infinity;
      lastObservedAtRef.current = null;
      gazeRef.current.reset();
      // Deferred so the setState isn't a direct synchronous call in the effect body.
      queueMicrotask(() => {
        setIsDegraded(false);
        setHasChecked(false);
      });
      setTickTimer(DETECT_INTERVAL_MS, "scheduled");
    } else {
      logger.log("[Proctoring] ⏹️ Interview inactive — stopping loop.");
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      stopIdentityChecks();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isActive]); // Only depends on isActive — no callback deps!

  useEffect(() => {
    if (!isActive) return;
    cameraRef.current = {
      hasPlayed: false,
      offSince: null,
      hinted: false,
      lastRaisedAt: -Infinity,
    };
    const timer = setInterval(() => checkCameraRef.current(), CAMERA_CHECK_MS);
    return () => clearInterval(timer);
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;
    const onKeyDown = () => {
      lastKeyAtRef.current = Date.now();
    };
    // Capture phase, so an editor that stops propagation still counts as typing.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isActive]);

  // Sampling stops the instant the interview does; the log waits until the
  // submission has answered so the one batch holds how it ended.
  const hasRunRef = useRef(false);
  useEffect(() => {
    if (isActive) {
      hasRunRef.current = true;
      return;
    }
    if (!hasRunRef.current) return;
    if (logReady) {
      flushQueue();
      return;
    }
    const timer = setTimeout(() => flushQueue(), LOG_SEND_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [isActive, logReady]);

  // Only a send that already failed is retried. Retrying mid-interview sent a
  // partial batch, and the real one after it was then never sent.
  useEffect(() => {
    const handleOnlineFlush = () => {
      if (queueRef.current.length > 0 && !hasFlushedRef.current && flushRetryCountRef.current > 0) {
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
    hasChecked,
    sampleSoon: requestSample,
  };
}
