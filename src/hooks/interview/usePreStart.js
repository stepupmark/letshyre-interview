import { useCallback, useEffect, useRef, useState } from "react";
import { recordViolationEvent } from "@/lib/violationLog";
import { loadFaceDetector } from "@/lib/localFaceDetector";
import { ackMatches, readRulesAck } from "@/lib/rulesAck";
import { RULES_VERSION } from "@/config/interviewRules";
import {
  FACE_MISMATCH_LIMIT,
  FACE_MISMATCH_TOTAL_LIMIT,
  HELD_RESTRIKE_SECONDS,
  MAX_INTERNET_DISCONNECTS,
  MAX_VIOLATIONS,
} from "@/config/interview";

export const PRE_START_LIMITS = {
  strikes: MAX_VIOLATIONS,
  faceInARow: FACE_MISMATCH_LIMIT,
  faceTotal: FACE_MISMATCH_TOTAL_LIMIT,
  disconnects: MAX_INTERNET_DISCONNECTS,
  heldSeconds: HELD_RESTRIKE_SECONDS,
};

const record = (outcome, extra) =>
  recordViolationEvent({ source: "session", type: "PRE_START", outcome, ...extra });

const hasDesktop = () => typeof window.electronAPI?.onViolation === "function";

/**
 * browser:  the rules, then the camera check.
 * desktop:  the rules only; the app's identity step already used the camera.
 * accepted: nothing; the candidate accepted these exact rules in the app.
 */
function startMode(isDesktop, ack) {
  if (!isDesktop) return "browser";
  return ackMatches(ack, { version: RULES_VERSION, ...PRE_START_LIMITS }) ? "accepted" : "desktop";
}

/**
 * Runs what the candidate still needs before `onReady`, which starts the
 * interview and its clock. Every step is written to the proctoring log.
 *
 * step: "rules" | "camera" | "done"
 */
export function usePreStart(onReady, options = {}) {
  const [{ mode, ack }] = useState(() => {
    const saved = options.ack ?? readRulesAck();
    return { mode: startMode(options.isDesktop ?? hasDesktop(), saved), ack: saved };
  });
  const [step, setStep] = useState(mode === "accepted" ? "done" : "rules");
  // A double click must not log twice or start two interviews.
  const doneRef = useRef({ rules: false, camera: false });

  const skipCameraAndStart = useCallback(() => {
    doneRef.current.camera = true;
    record("precheck_skipped", { reason: "identity_verified_in_app" });
    // Warm up the model the face watch needs soon after the start.
    loadFaceDetector().catch(() => {});
    setStep("done");
    onReady();
  }, [onReady]);

  useEffect(() => {
    if (mode !== "accepted" || doneRef.current.rules) return;
    doneRef.current.rules = true;
    record("rules_acknowledged", {
      limits: PRE_START_LIMITS,
      source: "desktop",
      acknowledged_at: ack?.at ?? null,
    });
    skipCameraAndStart();
  }, [mode, ack, skipCameraAndStart]);

  const acknowledgeRules = useCallback(() => {
    if (doneRef.current.rules) return;
    doneRef.current.rules = true;
    record("rules_acknowledged", { limits: PRE_START_LIMITS, source: "site" });
    if (mode === "desktop") {
      skipCameraAndStart();
    } else {
      setStep("camera");
    }
  }, [mode, skipCameraAndStart]);

  const finishCameraCheck = useCallback(
    ({ passed, ...detail }) => {
      if (doneRef.current.camera) return;
      doneRef.current.camera = true;
      record(passed ? "precheck_passed" : "precheck_skipped", detail);
      onReady();
    },
    [onReady],
  );

  return { step, limits: PRE_START_LIMITS, acknowledgeRules, finishCameraCheck };
}
