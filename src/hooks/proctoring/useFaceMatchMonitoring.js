import { useCallback, useEffect, useRef, useState } from "react";
import { useContinuousVerifyMutation } from "@mutations/useContinuousVerifyMutation";
import {
  FACE_MISMATCH_LIMIT,
  FACE_MISMATCH_TOTAL_LIMIT,
  FACE_PROBE_INTERVAL_MS,
  FACE_STRONG_MISMATCH_BELOW,
  FACE_UNCLEAR_HINT_MS,
  FACE_UNCLEAR_LIMIT_MS,
} from "@/config/interview";
import { TERMINATION_REASONS } from "@/lib/terminationReasons";
import { violationCopy } from "@/lib/violationCopy";
import { recordViolationEvent } from "@/lib/violationLog";
import { logger } from "@/lib/logger";

const MAX_UNAVAILABLE = 3;
// The service forgets registered faces when it restarts, so a lost session is
// registered again a couple of times before it counts as the service failing.
export const MAX_REREGISTERS = 2;
// Every false mismatch in real logs came from a frame the detector scored below
// this; genuine matches sat well above it.
export const MIN_FACE_CONFIDENCE = 0.8;
// Matches are most frames of an interview, so only one a minute is logged:
// enough for a reviewer to see identity was being checked.
export const MATCH_LOG_INTERVAL_MS = 60_000;

// `violation` carries two unrelated things. These are identity verdicts; the
// rest are frame conditions that stopped the comparison from happening.
const IDENTITY_VIOLATIONS = new Set(["FACE_MISMATCH"]);

const record = (outcome, extra) =>
  recordViolationEvent({ source: "face_match", type: "FACE_MISMATCH", outcome, ...extra });

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
  if (result.error === "SESSION_NOT_FOUND") return { verdict: "not_registered" };
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

/**
 * Only a match resets the run of mismatches. Anything else that can come
 * between two mismatches (leaving the frame, a failed call, a pause) is
 * something a candidate could arrange, so the run survives it.
 */
export const useFaceMatchMonitoring = ({
  sessionId,
  autoSubmit,
  onViolation,
  onNotRegistered,
  requestSample,
  isReady = true,
}) => {
  const [mismatchCount, setMismatchCount] = useState(0);
  const [isMonitoringStopped, setIsMonitoringStopped] = useState(false);
  const [isVerificationUnavailable, setIsVerificationUnavailable] = useState(false);

  const hasSubmittedRef = useRef(false);
  const streakRef = useRef(0);
  const totalRef = useRef(0);
  const stoppedRef = useRef(false);
  const inFlightRef = useRef(false);
  const unavailableRef = useRef(0);
  const unavailableSinceRef = useRef(0);
  const lastProbeAtRef = useRef(0);
  const reregistersRef = useRef(0);
  const lastClearAtRef = useRef(0);
  const unclearHintedRef = useRef(false);
  const lastMatchLoggedAtRef = useRef(null);
  const onViolationRef = useRef(onViolation);
  const autoSubmitRef = useRef(autoSubmit);
  const onNotRegisteredRef = useRef(onNotRegistered);
  const requestSampleRef = useRef(requestSample);
  const reportedUnregisteredRef = useRef(false);

  const { mutateAsync } = useContinuousVerifyMutation(sessionId);

  useEffect(() => {
    onViolationRef.current = onViolation;
    autoSubmitRef.current = autoSubmit;
    onNotRegisteredRef.current = onNotRegistered;
    requestSampleRef.current = requestSample;
  });

  useEffect(() => {
    reregistersRef.current = 0;
  }, [sessionId]);

  // The unclear clock starts again once there is a reference face to compare with.
  useEffect(() => {
    if (!isReady) lastClearAtRef.current = 0;
  }, [isReady]);

  const sawClearFace = useCallback((at) => {
    lastClearAtRef.current = at;
    unclearHintedRef.current = false;
  }, []);

  // A frame nobody checked for blur can't be the one that ends the interview on
  // its own: it needs one more mismatch behind it.
  const countMismatch = useCallback(({ vetted, similarity, detail }) => {
    const streak = (streakRef.current += 1);
    const total = (totalRef.current += 1);
    setMismatchCount(streak);
    const counts = { violation_count: streak, total_count: total, vetted, ...detail };
    record("raised", counts);

    const extra = vetted ? 0 : 1;
    const strong =
      vetted &&
      FACE_STRONG_MISMATCH_BELOW > 0 &&
      typeof similarity === "number" &&
      similarity < FACE_STRONG_MISMATCH_BELOW;
    const rule = strong
      ? "strong"
      : streak >= FACE_MISMATCH_LIMIT + extra
        ? "in_a_row"
        : total >= FACE_MISMATCH_TOTAL_LIMIT + extra
          ? "total"
          : null;

    if (rule) {
      if (hasSubmittedRef.current) return;
      hasSubmittedRef.current = true;
      stoppedRef.current = true;
      setIsMonitoringStopped(true);
      record("terminated", { ...counts, rule });
      // No modal here: the termination notice owns the screen and a warning
      // under it would promise a way back that no longer exists.
      autoSubmitRef.current?.(TERMINATION_REASONS.FACE_MISMATCH);
      return;
    }

    // Warn only. Identity runs to its own limits, so this must not also spend
    // a proctoring strike.
    onViolationRef.current?.({
      type: "FACE_MISMATCH",
      ...violationCopy("FACE_MISMATCH"),
      countsAsViolation: false,
      finalWarning: streak + 1 >= FACE_MISMATCH_LIMIT || total + 1 >= FACE_MISMATCH_TOTAL_LIMIT,
      detail: { origin: "face_match", ...counts },
    });
    requestSampleRef.current?.("face_mismatch");
  }, []);

  const markUnavailable = useCallback((reason, at) => {
    unavailableRef.current += 1;
    record("unavailable", { error: reason });
    if (unavailableRef.current < MAX_UNAVAILABLE || unavailableSinceRef.current) return;
    unavailableSinceRef.current = at;
    lastProbeAtRef.current = at;
    logger.error(`[FaceMatch] verification unavailable (${reason}), retrying in the background.`);
    record("verification_unavailable", { error: reason });
    setIsVerificationUnavailable(true);
  }, []);

  // An outage is ours, not the candidate's, so the unclear clock skips it.
  const markAvailable = useCallback(
    (at) => {
      unavailableRef.current = 0;
      if (!unavailableSinceRef.current) return;
      record("verification_restored", { unavailable_ms: at - unavailableSinceRef.current });
      unavailableSinceRef.current = 0;
      sawClearFace(at);
      setIsVerificationUnavailable(false);
    },
    [sawClearFace],
  );

  // Someone who keeps their face turned or dim is never compared, so the time
  // since the last clear face is itself held against them.
  const checkUnclear = useCallback(
    (at) => {
      if (unavailableSinceRef.current) return;
      requestSampleRef.current?.("face_unclear");

      const unclearFor = at - lastClearAtRef.current;
      if (unclearFor >= FACE_UNCLEAR_LIMIT_MS) {
        sawClearFace(at);
        countMismatch({ vetted: true, detail: { reason: "unclear", unclear_ms: unclearFor } });
        return;
      }
      if (unclearFor >= FACE_UNCLEAR_HINT_MS && !unclearHintedRef.current) {
        unclearHintedRef.current = true;
        record("unclear_hint", { unclear_ms: unclearFor });
        onViolationRef.current?.({
          type: "FACE_UNCLEAR",
          ...violationCopy("FACE_UNCLEAR"),
          countsAsViolation: false,
        });
      }
    },
    [countMismatch, sawClearFace],
  );

  const evaluate = useCallback(
    (result, { at, vetted, faceConfidence }) => {
      const classified = classifyVerification(result);
      const { confidence, serverTotal } = classified;
      let { verdict, reason } = classified;

      const scores = {
        ...(confidence === undefined ? {} : { confidence }),
        ...(faceConfidence === undefined ? {} : { face_confidence: faceConfidence }),
        // The service keeps its own cumulative tally, which also counts no-face
        // frames. Logged next to ours so the two stay comparable.
        ...(serverTotal === undefined ? {} : { server_total: serverTotal }),
      };

      if (verdict === "not_registered") {
        if (onNotRegisteredRef.current && reregistersRef.current < MAX_REREGISTERS) {
          reregistersRef.current += 1;
          record("reregistering", { attempt: reregistersRef.current });
          onNotRegisteredRef.current();
          return;
        }
        verdict = "unavailable";
        reason = "SESSION_NOT_FOUND";
      }

      if (verdict === "unavailable") {
        markUnavailable(reason, at);
        return;
      }
      markAvailable(at);

      if (verdict === "mismatch") {
        sawClearFace(at);
        countMismatch({ vetted, similarity: confidence, detail: scores });
        return;
      }

      if (verdict === "match") {
        sawClearFace(at);
        const hadStreak = streakRef.current > 0;
        streakRef.current = 0;
        setMismatchCount(0);
        if (hadStreak) {
          record("cleared", { total_count: totalRef.current, ...scores });
          lastMatchLoggedAtRef.current = at;
        } else if (
          lastMatchLoggedAtRef.current === null ||
          at - lastMatchLoggedAtRef.current >= MATCH_LOG_INTERVAL_MS
        ) {
          record("matched", scores);
          lastMatchLoggedAtRef.current = at;
        }
        return;
      }

      // Detection owns face presence; raising it here too struck the same frame twice.
      if (verdict === "condition") {
        record("condition", { condition: reason });
        return;
      }

      record("no_verdict", { reason });
    },
    [countMismatch, markAvailable, markUnavailable, sawClearFace],
  );

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
          record("not_registered");
        }
        return;
      }

      if (!sample?.file) return;
      const at = sample.capturedAt ?? Date.now();
      if (!lastClearAtRef.current) lastClearAtRef.current = at;

      // No face or several: detection strikes those, and the run is kept.
      if (sample.faceCount !== undefined && sample.faceCount !== 1) return;

      const { faceConfidence } = sample;
      if (faceConfidence !== undefined && faceConfidence < MIN_FACE_CONFIDENCE) {
        record("skipped", { face_confidence: faceConfidence });
        checkUnclear(at);
        return;
      }

      // Unknown count or confidence means detection failed on this frame.
      const vetted = sample.faceCount === 1 && faceConfidence !== undefined;
      if (vetted) sawClearFace(at);

      if (unavailableSinceRef.current) {
        if (at - lastProbeAtRef.current < FACE_PROBE_INTERVAL_MS) return;
        lastProbeAtRef.current = at;
      }

      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const result = await mutateAsync({ imageFile: sample.file });
        if (!stoppedRef.current) evaluate(result, { at, vetted, faceConfidence });
      } catch (err) {
        if (!stoppedRef.current) markUnavailable(err?.message || "request_failed", at);
      } finally {
        inFlightRef.current = false;
      }
    },
    [sessionId, isReady, mutateAsync, evaluate, checkUnclear, markUnavailable, sawClearFace],
  );

  return {
    mismatchCount,
    isMonitoringStopped,
    isVerificationUnavailable,
    verifySample,
  };
};
