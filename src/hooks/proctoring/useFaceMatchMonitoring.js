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

// Both honest mismatches in live logs came on the first clear frame after the
// face was missing or unclear, and cleared on the next one. Such a mismatch
// waits this long for a second look before it counts.
const RECHECK_MS = 1_000;

// Only these describe a mismatch. Every other record is a FACE_CHECK, so a
// reviewer filtering for mismatches sees only mismatches.
const MISMATCH_OUTCOMES = new Set(["raised", "held", "terminated"]);

const record = (outcome, extra) =>
  recordViolationEvent({
    source: "face_match",
    type: MISMATCH_OUTCOMES.has(outcome) ? "FACE_MISMATCH" : "FACE_CHECK",
    outcome,
    ...extra,
  });

const isStrongMismatch = (vetted, similarity) =>
  vetted &&
  FACE_STRONG_MISMATCH_BELOW > 0 &&
  typeof similarity === "number" &&
  similarity < FACE_STRONG_MISMATCH_BELOW;

// What each `violation` means for identity and for the faces in the frame.
const VIOLATIONS = {
  FACE_MISMATCH: { verdict: "mismatch" },
  FACE_MISMATCH_AND_MULTIPLE_FACES: { verdict: "mismatch", faces: "multiple" },
  MULTIPLE_FACES: { verdict: "condition", faces: "multiple" },
  NO_FACE: { verdict: "condition", faces: "none" },
};
const IDENTITY_VERDICTS = new Set(["match", "mismatch"]);

/**
 * Verdicts come from `violation` and `same_person` only. `success` is false
 * on several real verdicts, the combined mismatch among them, so reading it
 * dropped an impostor with people behind them. `error` is read only to tell a
 * lost session or an outage from a verdict.
 */
export function classifyVerification(result) {
  if (!result || typeof result !== "object") return { verdict: "no_verdict" };
  if (result.error === "SESSION_NOT_FOUND") return { verdict: "not_registered" };
  if (result.error) return { verdict: "unavailable", reason: result.error };

  const { violation } = result;
  if (violation) {
    const known = VIOLATIONS[violation];
    if (!known) return { verdict: "no_verdict", reason: "unknown_violation", violation };
    return known.verdict === "mismatch"
      ? {
          ...known,
          confidence: result.confidence ?? undefined,
          serverTotal: result.total_violations ?? undefined,
        }
      : { ...known, reason: violation };
  }

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
  const lastFrameClearRef = useRef(true);
  const heldRef = useRef(false);
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
    const rule = isStrongMismatch(vetted, similarity)
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

  // What detection saw decides whether a verdict on this frame can count.
  const judge = useCallback(
    ({ faceCount, faceConfidence }, at) => {
      if (faceCount === 0) {
        lastFrameClearRef.current = false;
        return { compares: false };
      }

      if (faceConfidence !== undefined && faceConfidence < MIN_FACE_CONFIDENCE) {
        lastFrameClearRef.current = false;
        if (faceCount === 1) {
          record("skipped", { face_confidence: faceConfidence });
          checkUnclear(at);
        }
        return { compares: false, faceConfidence };
      }

      // Unknown count or confidence means detection failed on this frame. With
      // several faces the service may have compared the wrong one.
      const vetted = faceCount === 1 && faceConfidence !== undefined;
      const afterGap = vetted && !lastFrameClearRef.current;
      if (faceCount !== undefined) lastFrameClearRef.current = vetted;
      if (vetted) sawClearFace(at);
      return { compares: true, vetted, afterGap, faceConfidence };
    },
    [checkUnclear, sawClearFace],
  );

  const evaluate = useCallback(
    (result, { at, compares, vetted, afterGap, faceConfidence }) => {
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
          return classified;
        }
        verdict = "unavailable";
        reason = "SESSION_NOT_FOUND";
      }

      if (verdict === "unavailable") {
        markUnavailable(reason, at);
        return classified;
      }
      markAvailable(at);

      // Sent before detection answered, on a frame it then ruled out.
      if (!compares && IDENTITY_VERDICTS.has(verdict)) return classified;

      if (verdict === "mismatch") {
        sawClearFace(at);
        if (afterGap && !heldRef.current && !isStrongMismatch(vetted, confidence)) {
          heldRef.current = true;
          record("held", scores);
          requestSampleRef.current?.("face_recheck", RECHECK_MS);
          return classified;
        }
        heldRef.current = false;
        countMismatch({ vetted, similarity: confidence, detail: scores });
        return classified;
      }

      if (verdict === "match") {
        sawClearFace(at);
        if (heldRef.current) {
          heldRef.current = false;
          record("settled", scores);
        }
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
        return classified;
      }

      // The camera loop counts these, merged with what detection saw on the frame.
      if (verdict === "condition") {
        record("condition", { condition: reason });
        return classified;
      }

      record("no_verdict", {
        reason,
        ...(classified.violation ? { violation: classified.violation } : {}),
      });
      return classified;
    },
    [countMismatch, markAvailable, markUnavailable, sawClearFace],
  );

  // Driven by the proctoring loop's sampler rather than its own timer, so the
  // identity verdict and the object verdict describe the same frame. Resolves
  // with the faces the service saw ("none", "one" or "multiple"), which the
  // loop counts together with detection's, and how long the call took. With
  // `sample.detection` (a promise) the frame is sent at once and judged once
  // detection answers.
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

      // Already known to be no face or unclear: not worth a call.
      const known = sample.detection ? null : judge(sample, at);
      if (known && !known.compares) return;

      let request = null;
      const probing = unavailableSinceRef.current;
      if (
        !inFlightRef.current &&
        (!probing || at - lastProbeAtRef.current >= FACE_PROBE_INTERVAL_MS)
      ) {
        if (probing) lastProbeAtRef.current = at;
        inFlightRef.current = true;
        request = (async () => {
          const sentAt = Date.now();
          try {
            const result = await mutateAsync({ imageFile: sample.file });
            return { result, verifyMs: Date.now() - sentAt };
          } catch (error) {
            return { error };
          }
        })();
      }

      try {
        const judged = known ?? judge((await sample.detection) ?? {}, at);
        if (!request) return;
        const { result, error, verifyMs } = await request;
        if (stoppedRef.current) return;
        if (error) {
          markUnavailable(error?.message || "request_failed", at);
          return;
        }
        const { verdict, faces } = evaluate(result, { at, ...judged });
        // The interview ended on this frame; there is nothing left to count.
        if (stoppedRef.current) return;
        return { faces: faces ?? (IDENTITY_VERDICTS.has(verdict) ? "one" : null), verifyMs };
      } finally {
        if (request) inFlightRef.current = false;
      }
    },
    [sessionId, isReady, mutateAsync, evaluate, judge, markUnavailable],
  );

  return {
    mismatchCount,
    isMonitoringStopped,
    isVerificationUnavailable,
    verifySample,
  };
};
