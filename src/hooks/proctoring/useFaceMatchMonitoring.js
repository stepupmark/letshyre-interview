import { useCallback, useEffect, useRef, useState } from "react";
import { useContinuousVerifyMutation } from "@mutations/useContinuousVerifyMutation";
import { RESEED_AFTER_GAP_MS } from "./useProctoringSystem";
import { FACE_MISMATCH_LIMIT } from "@/config/interview";
import { TERMINATION_REASONS } from "@/lib/terminationReasons";
import { violationCopy } from "@/lib/violationCopy";
import { recordViolationEvent } from "@/lib/violationLog";

const MAX_UNAVAILABLE = 3;
// Every false mismatch in real logs came from a frame the detector scored below
// this; genuine matches sat well above it.
export const MIN_FACE_CONFIDENCE = 0.8;

// `violation` carries two unrelated things. These are identity verdicts; the
// rest are frame conditions that stopped the comparison from happening.
const IDENTITY_VIOLATIONS = new Set(["FACE_MISMATCH"]);

/**
 * The fields carry independent meaning: `error` means the call never ran,
 * `violation` means either an identity verdict or a frame condition, and
 * `same_person` is only a verdict once `success` is true. Read out of order, a
 * no-face frame looks exactly like an impostor.
 *
 * A real mismatch arrives in `same_person` and `violation` at once, so either
 * one is enough. Reading `violation` first used to file it as a condition and
 * silently drop it.
 */
export function classifyVerification(result) {
  if (!result || typeof result !== "object") return { verdict: "no_verdict" };
  if (result.error) return { verdict: "unavailable", reason: result.error };

  if (
    result.success === true &&
    (result.same_person === false || IDENTITY_VIOLATIONS.has(result.violation))
  ) {
    return {
      verdict: "mismatch",
      confidence: result.confidence,
      serverTotal: result.total_violations,
    };
  }

  if (result.violation) return { verdict: "condition", reason: result.violation };
  if (result.success !== true) return { verdict: "no_verdict", reason: "unsuccessful_response" };
  if (result.same_person === true) return { verdict: "match", confidence: result.confidence };
  return { verdict: "no_verdict", reason: "unrecognized_response" };
}

export const useFaceMatchMonitoring = ({ sessionId, autoSubmit, onViolation, isReady = true }) => {
  const [mismatchCount, setMismatchCount] = useState(0);
  const [isMonitoringStopped, setIsMonitoringStopped] = useState(false);
  const [isVerificationUnavailable, setIsVerificationUnavailable] = useState(false);

  const hasSubmittedRef = useRef(false);
  const streakRef = useRef(0);
  const stoppedRef = useRef(false);
  const inFlightRef = useRef(false);
  const unavailableRef = useRef(0);
  const lastSampleAtRef = useRef(0);
  const onViolationRef = useRef(onViolation);
  const autoSubmitRef = useRef(autoSubmit);
  const reportedUnregisteredRef = useRef(false);

  const verifyMutation = useContinuousVerifyMutation(sessionId);
  const { mutateAsync } = verifyMutation;

  useEffect(() => {
    onViolationRef.current = onViolation;
    autoSubmitRef.current = autoSubmit;
  });

  useEffect(() => {
    stoppedRef.current = isMonitoringStopped;
  }, [isMonitoringStopped]);

  const evaluate = useCallback((result) => {
    const { verdict, reason, confidence, serverTotal } = classifyVerification(result);

    const report = (outcome, extra) =>
      recordViolationEvent({
        source: "face_match",
        type: "FACE_MISMATCH",
        outcome,
        ...(confidence === undefined ? {} : { confidence }),
        // The service keeps its own cumulative tally; ours is the consecutive
        // run. Logging both leaves the two comparable.
        ...(serverTotal === undefined ? {} : { server_total: serverTotal }),
        ...extra,
      });

    if (verdict !== "unavailable") unavailableRef.current = 0;
    const hadStreak = streakRef.current > 0;

    if (verdict === "mismatch") {
      const streak = (streakRef.current += 1);
      setMismatchCount(streak);
      report("raised", { violation_count: streak });

      if (streak >= FACE_MISMATCH_LIMIT) {
        if (hasSubmittedRef.current) return;
        hasSubmittedRef.current = true;
        stoppedRef.current = true;
        setIsMonitoringStopped(true);
        report("terminated", { violation_count: streak });
        // No modal here: the termination notice owns the screen and a warning
        // under it would promise a way back that no longer exists.
        autoSubmitRef.current?.(TERMINATION_REASONS.FACE_MISMATCH);
        return;
      }

      // Warn only. Identity runs to its own limit, so this must not also spend
      // a proctoring strike.
      onViolationRef.current?.({
        type: "FACE_MISMATCH",
        ...violationCopy("FACE_MISMATCH"),
        countsAsViolation: false,
        finalWarning: streak === FACE_MISMATCH_LIMIT - 1,
        detail: { origin: "face_match", violation_count: streak },
      });
      return;
    }

    streakRef.current = 0;

    if (verdict === "match") {
      hasSubmittedRef.current = false;
      setMismatchCount(0);
      // A match is most frames of the interview and says nothing on its own.
      // Only the recovery from a mismatch is worth a record.
      if (hadStreak) report("cleared");
      return;
    }

    // Detection owns face presence; raising it here too struck the same frame twice.
    if (verdict === "condition") {
      report("condition", { condition: reason });
      return;
    }

    if (verdict === "unavailable") {
      unavailableRef.current += 1;
      report("unavailable", { error: reason });
      if (unavailableRef.current >= MAX_UNAVAILABLE) setIsVerificationUnavailable(true);
      return;
    }

    report("no_verdict", { reason });
  }, []);

  // Driven by the proctoring loop's sampler rather than its own timer, so the
  // identity verdict and the object verdict describe the same frame.
  const verifySample = useCallback(
    async (sample) => {
      if (!sessionId || stoppedRef.current) return;

      // Without a registered reference face there is nothing to compare against.
      // Recorded once, so an interview that ran unverified says so.
      if (!isReady) {
        if (!reportedUnregisteredRef.current) {
          reportedUnregisteredRef.current = true;
          recordViolationEvent({
            source: "face_match",
            type: "FACE_MISMATCH",
            outcome: "not_registered",
          });
        }
        return;
      }

      if (!sample?.file || inFlightRef.current) return;

      // Biometric verification executes only on single-face frames.
      if (sample.faceCount !== undefined && sample.faceCount !== 1) {
        streakRef.current = 0;
        return;
      }

      // Skip low-confidence faces without breaking streak.
      if (sample.faceConfidence !== undefined && sample.faceConfidence < MIN_FACE_CONFIDENCE) {
        recordViolationEvent({
          source: "face_match",
          type: "FACE_MISMATCH",
          outcome: "skipped",
          face_confidence: sample.faceConfidence,
        });
        return;
      }

      // Reset verification streak if inter-frame interval exceeds gap threshold.
      const capturedAt = sample.capturedAt ?? Date.now();
      const blindAfter = Math.max(RESEED_AFTER_GAP_MS, (sample.intervalMs ?? 0) * 2);
      if (lastSampleAtRef.current && capturedAt - lastSampleAtRef.current > blindAfter) {
        streakRef.current = 0;
      }
      lastSampleAtRef.current = capturedAt;

      inFlightRef.current = true;
      try {
        const result = await mutateAsync({ imageFile: sample.file });
        if (!stoppedRef.current) evaluate(result);
      } catch {
        streakRef.current = 0;
        recordViolationEvent({ source: "face_match", type: "FACE_MISMATCH", outcome: "failed" });
      } finally {
        inFlightRef.current = false;
      }
    },
    [sessionId, isReady, mutateAsync, evaluate],
  );

  // Verification is a proctoring control, so losing it has to leave a trace
  // rather than quietly stopping. It never counts against the candidate.
  useEffect(() => {
    if (!isVerificationUnavailable) return;
    stoppedRef.current = true;
    queueMicrotask(() => setIsMonitoringStopped(true));
    recordViolationEvent({
      source: "face_match",
      type: "FACE_MISMATCH",
      outcome: "verification_unavailable",
    });
  }, [isVerificationUnavailable]);

  return {
    mismatchCount,
    isMonitoringStopped,
    isVerificationUnavailable,
    verifySample,
    verifyMutation,
  };
};
