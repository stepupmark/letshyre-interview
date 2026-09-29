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

// Mismatches with no match between them before auto-submit. Only a match
// resets the run; a no-face frame, an error or a pause does not.
export const FACE_MISMATCH_LIMIT = num(import.meta.env.VITE_AI_FACE_MISMATCH_LIMIT, 2);

// Mismatches across the whole interview, matches or not, before auto-submit.
export const FACE_MISMATCH_TOTAL_LIMIT = num(import.meta.env.VITE_AI_FACE_MISMATCH_TOTAL_LIMIT, 3);

// A face too unclear to compare for this long gets a hint, and for the longer
// one counts as a mismatch.
export const FACE_UNCLEAR_HINT_MS =
  num(import.meta.env.VITE_AI_FACE_UNCLEAR_HINT_SECONDS, 30) * 1000;
export const FACE_UNCLEAR_LIMIT_MS =
  num(import.meta.env.VITE_AI_FACE_UNCLEAR_LIMIT_SECONDS, 60) * 1000;

// While the verification service is down, one frame per this interval checks
// whether it is back.
export const FACE_PROBE_INTERVAL_MS = 30_000;

// A mismatch only counts below this similarity. The candidate's own face dips
// to about 0.5 on a bad frame while someone else scores near 0, so a score in
// between is treated as an unclear face rather than as someone else.
export const FACE_MISMATCH_BELOW = num(import.meta.env.VITE_AI_FACE_MISMATCH_BELOW, 0.4);

// Similarity below this on a clear frame ends the interview on the first
// mismatch. Off until real interviews show where honest candidates never land.
export const FACE_STRONG_MISMATCH_BELOW = num(
  import.meta.env.VITE_AI_FACE_STRONG_MISMATCH_BELOW,
  0,
);

// Counts faces on the device between server checks so a face leaving or a
// second one arriving is looked at straight away. "false" turns it off.
export const LOCAL_FACE_WATCH = import.meta.env.VITE_AI_LOCAL_FACE_WATCH !== "false";

// Looks for a phone on the device once a second so one coming into view is
// checked straight away. "false" turns it off.
export const LOCAL_OBJECT_WATCH = import.meta.env.VITE_AI_LOCAL_OBJECT_WATCH !== "false";

// Internet disconnects allowed before auto-submit. Tracked separately from
// proctoring violations — a dropped connection is not misconduct.
export const MAX_INTERNET_DISCONNECTS = num(import.meta.env.VITE_AI_MAX_INTERNET_DISCONNECTS, 3);

// The oldest desktop app allowed to start an interview, e.g. "1.4.5". Unset lets
// every build through, so set it only once the new build is out.
export const MIN_DESKTOP_VERSION = import.meta.env.VITE_MIN_DESKTOP_VERSION ?? "";

// How long the final termination notice stays on screen before it proceeds on
// its own. The candidate can acknowledge sooner; they can never delay past it.
export const TERMINATION_NOTICE_SECONDS = num(
  import.meta.env.VITE_AI_TERMINATION_NOTICE_SECONDS,
  12,
);

// How long a prohibited object or a switched-off camera can stay before it
// costs one more strike.
export const HELD_RESTRIKE_SECONDS = num(import.meta.env.VITE_AI_HELD_RESTRIKE_SECONDS, 30);

// The camera check before the interview. Every check has to hold for
// CAMERA_CHECK_HOLD_MS; each attempt gets CAMERA_CHECK_ATTEMPT_MS, and after
// CAMERA_CHECK_MAX_ATTEMPTS failed ones the candidate may continue anyway.
export const CAMERA_CHECK_HOLD_MS = 1_500;
export const CAMERA_CHECK_ATTEMPT_MS = 10_000;
export const CAMERA_CHECK_MAX_ATTEMPTS = 3;
// A camera or detector that hasn't produced a frame by then is treated as unavailable.
export const CAMERA_CHECK_START_TIMEOUT_MS = 20_000;
// Mean luminance (0-255) a frame needs to count as lit well enough.
export const CAMERA_CHECK_MIN_LUMINANCE = num(import.meta.env.VITE_CAMERA_CHECK_MIN_LUMINANCE, 60);
// How far the face centre may sit from the frame centre, as a share of the frame.
export const CAMERA_CHECK_CENTRE_TOLERANCE = 0.2;

// Generating the questions is slow, so the start request gets longer than usual.
export const START_TIMEOUT_MS = 60_000;
export const START_RETRY_DELAY_MS = 3_000;

// Interview length in minutes.
export const INTERVIEW_DURATION_MINUTES = num(
  import.meta.env.VITE_AI_INTERVIEW_DURATION_MINUTES,
  15,
);

// Confidence an object detection must carry before it can become a violation.
// The detector's own list is trusted above this; below it the box is logged and
// dropped. Raise it if cluttered rooms start producing false warnings.
export const OBJECT_CONFIDENCE_FLOOR = num(import.meta.env.VITE_AI_OBJECT_CONFIDENCE_FLOOR, 0.35);

// Laptops are a live proctoring concern but the highest false-positive label in
// the set — YOLO reads TVs, picture frames and shelves as one. Kill switch so
// enforcement can be pulled without a redeploy.
export const PROHIBIT_LAPTOP = import.meta.env.VITE_AI_PROHIBIT_LAPTOP !== "false";

// Labels detected and logged but never surfaced to the candidate, so a new rule
// can be measured against real interviews before it starts ending them.
// PROHIBIT_LAPTOP wins: a stale shadow entry muted every laptop in production.
export const SHADOW_LABELS = new Set(
  (import.meta.env.VITE_AI_SHADOW_LABELS ?? "tv")
    .split(",")
    .map((label) => label.trim().toLowerCase())
    .filter((label) => label && !(PROHIBIT_LAPTOP && label === "laptop")),
);

// Behaviour rules (not labels) logged but never shown or counted, for the same
// reason. "gaze" is the long look-away strike; "verify_faces" is a no-face or
// several-people strike that only face verification saw. An empty value keeps
// the default so an unset CI variable can't switch enforcement on; use "none"
// to enforce.
export const SHADOW_RULES = new Set(
  (import.meta.env.VITE_AI_SHADOW_RULES || "gaze")
    .split(",")
    .map((rule) => rule.trim().toLowerCase())
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
