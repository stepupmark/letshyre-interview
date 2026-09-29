/**
 * One channel for every violation decision, whatever raised it.
 *
 * The proctoring queue lives in useProctoringSystem, but tab switches,
 * fullscreen exits, window resizes and Electron blocks are raised from
 * useViolationMonitor and used to strike candidates without leaving any record
 * at all. Both now publish here and the queue subscribes, so a terminated
 * interview can always be reconstructed.
 *
 * Every record gets a `category` and `counts_as_strike` here, so a reviewer
 * can filter the log without knowing which hook wrote what, and
 * `recording_offset_ms` while the desktop app is recording, to find the moment
 * in the video.
 */

import { hasRecordingState, recordingOffsetMs, recordingSummary } from "@/lib/electronRecording";

const listeners = new Set();

const CATEGORY_BY_TYPE = {
  FACE_MISMATCH: "identity",
  FACE_UNCLEAR: "identity",
  FACE_CHECK: "identity",
  VOICE_MISMATCH: "voice",
  RECORDING: "voice",
  NETWORK_DISCONNECT: "network",
  INPUT_BLOCKED: "input",
  INTERVIEW_ENDED: "session",
};

const CATEGORY_BY_SOURCE = {
  ai: "detection",
  camera: "detection",
  local: "detection",
  face_match: "identity",
  voice: "voice",
  electron: "desktop",
  network: "network",
  input: "input",
  session: "session",
  window: "window",
  tab_switch: "window",
  window_focus: "window",
  fullscreen_exit: "window",
  window_resize: "window",
};

function categoryOf({ type, source }) {
  return CATEGORY_BY_TYPE[type] ?? CATEGORY_BY_SOURCE[source] ?? "other";
}

// Face mismatches have their own limit, kept here as they pass through so the
// record that explains an ending can quote them.
let faceMismatches = { in_a_row: 0, total: 0 };

function track(record) {
  if (record.source !== "face_match") return;
  if (record.outcome === "raised" || record.outcome === "terminated") {
    faceMismatches = {
      in_a_row: record.violation_count ?? faceMismatches.in_a_row,
      total: record.total_count ?? faceMismatches.total,
    };
  } else if (record.outcome === "cleared") {
    faceMismatches = { ...faceMismatches, in_a_row: 0 };
  }
}

export function subscribeToViolationLog(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function recordViolationEvent(event) {
  const offset = recordingOffsetMs();
  const record = {
    ...event,
    category: event.category ?? categoryOf(event),
    counts_as_strike: event.counts_as_strike ?? false,
    ...(offset === null ? {} : { recording_offset_ms: offset }),
  };
  track(record);
  for (const listener of listeners) listener(record);
}

export function faceMismatchSummary() {
  return { ...faceMismatches };
}

// How closely the camera loop actually watched, fed once per check.
const emptyChecks = () => ({
  count: 0,
  firstAt: null,
  lastAt: null,
  detectMs: [],
  verifyMs: [],
  unobservedMs: 0,
});
let checks = emptyChecks();

export function recordCheckStats({ at, detectMs, verifyMs, unobservedMs }) {
  if (at !== undefined) {
    checks.count += 1;
    checks.firstAt ??= at;
    checks.lastAt = at;
  }
  if (typeof detectMs === "number") checks.detectMs.push(detectMs);
  if (typeof verifyMs === "number") checks.verifyMs.push(verifyMs);
  if (unobservedMs) checks.unobservedMs += unobservedMs;
}

function percentiles(values) {
  if (!values.length) return { p50: null, p95: null };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) => sorted[Math.ceil(p * sorted.length) - 1];
  return { p50: at(0.5), p95: at(0.95) };
}

export function checkSummary() {
  const minutes = (checks.lastAt - checks.firstAt) / 60_000;
  return {
    count: checks.count,
    per_minute:
      checks.count > 1 && minutes > 0 ? Math.round(((checks.count - 1) / minutes) * 10) / 10 : null,
    detect_ms: percentiles(checks.detectMs),
    verify_ms: percentiles(checks.verifyMs),
    unobserved_ms: checks.unobservedMs,
  };
}

export function resetViolationSummary() {
  faceMismatches = { in_a_row: 0, total: 0 };
  checks = emptyChecks();
}

/**
 * The record a reviewer reads first: how the interview ended and what led to
 * it. Written when the interview stops and again when its submission settles,
 * both before the log is sent.
 */
export function recordInterviewEnded({ outcome, reason, strikes, ...rest }) {
  recordViolationEvent({
    source: "session",
    type: "INTERVIEW_ENDED",
    outcome,
    ...(reason ? { reason } : {}),
    ...(strikes
      ? {
          strikes: strikes.map((strike) => ({
            count: strike.count,
            ...(strike.type ? { type: strike.type } : {}),
            ...(strike.label ? { label: strike.label } : {}),
            ...(strike.labels?.length > 1 ? { labels: strike.labels } : {}),
            at: new Date(strike.at).toISOString(),
          })),
        }
      : {}),
    face_mismatches: faceMismatchSummary(),
    checks: checkSummary(),
    ...(hasRecordingState() ? { recording: recordingSummary() } : {}),
    ...rest,
  });
}
