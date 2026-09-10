/**
 * Central interview tunables. Single source of truth so the UI, the session
 * state machine, and the monitors never disagree about thresholds.
 *
 * Env values arrive as strings — coerce with Number() and fall back to a
 * sensible default when unset or non-numeric.
 */
const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// Proctoring violations (tab switch, fullscreen exit, multiple faces, phone …)
// allowed before the interview is auto-submitted.
export const MAX_VIOLATIONS = num(import.meta.env.VITE_AI_MAX_VIOLATIONS_ALLOWED, 3);

// Consecutive face mismatches allowed before auto-submit.
export const FACE_MISMATCH_LIMIT = num(import.meta.env.VITE_AI_FACE_MISMATCH_LIMIT, 2);

// Internet disconnects allowed before auto-submit. Tracked separately from
// proctoring violations — a dropped connection is not misconduct.
export const MAX_INTERNET_DISCONNECTS = num(import.meta.env.VITE_AI_MAX_INTERNET_DISCONNECTS, 3);

// How long the final termination notice stays on screen before it proceeds on
// its own. The candidate can acknowledge sooner; they can never delay past it.
export const TERMINATION_NOTICE_SECONDS = num(
  import.meta.env.VITE_AI_TERMINATION_NOTICE_SECONDS,
  8,
);

// Interview length in minutes.
export const INTERVIEW_DURATION_MINUTES = num(
  import.meta.env.VITE_AI_INTERVIEW_DURATION_MINUTES,
  15,
);

// Laptops are a live proctoring concern but the highest false-positive label in
// the set — YOLO reads TVs, picture frames and shelves as one. Kill switch so
// enforcement can be pulled without a redeploy.
export const PROHIBIT_LAPTOP = import.meta.env.VITE_AI_PROHIBIT_LAPTOP !== "false";

// Labels detected and logged but never surfaced to the candidate, so a new rule
// can be measured against real interviews before it starts ending them.
export const SHADOW_LABELS = new Set(
  (import.meta.env.VITE_AI_SHADOW_LABELS ?? "laptop")
    .split(",")
    .map((label) => label.trim().toLowerCase())
    .filter(Boolean),
);

// sessionStorage key holding the in-progress interview session. Shared so the
// session hook and the post-interview UI never drift on the literal.
export const INTERVIEW_SESSION_STORAGE_KEY = "interview_session";

// Interview session lifecycle states. Shared across useInterviewSession and
// useAutoSubmitFlow so they can't drift into two different string literals.
export const SESSION_STATUS = {
  ACTIVE: "active",
  COMPLETED: "completed",
  TERMINATED: "terminated",
  EXPIRED: "expired",
};
