import { useCallback, useRef, useState } from "react";
import { recordViolationEvent } from "@/lib/violationLog";
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

/**
 * The rules, then the camera check, then `onReady`, which starts the interview
 * and its clock. Both steps are written to the proctoring log.
 *
 * step: "rules" | "camera"
 */
export function usePreStart(onReady) {
  const [step, setStep] = useState("rules");
  // A double click must not log twice or start two interviews.
  const doneRef = useRef({ rules: false, camera: false });

  const acknowledgeRules = useCallback(() => {
    if (doneRef.current.rules) return;
    doneRef.current.rules = true;
    record("rules_acknowledged", { limits: PRE_START_LIMITS });
    setStep("camera");
  }, []);

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
