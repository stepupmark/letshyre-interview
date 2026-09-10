import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useContinuousVerify } from "@queries/useContinuousVerify";
import { FACE_MISMATCH_LIMIT } from "@/config/interview";
import { TERMINATION_REASONS } from "@/lib/terminationReasons";
import { createViolationStabilizer } from "@/lib/violationStabilizer";
import { recordViolationEvent } from "@/lib/violationLog";

// A verdict returned on a frame this poor is not evidence either way.
const MIN_FRAME_QUALITY = 0.25;

export const useFaceMatchMonitoring = ({ sessionId, captureImage, autoSubmit, isReady = true }) => {
  const [mismatchCount, setMismatchCount] = useState(0);
  const [isMonitoringStopped, setIsMonitoringStopped] = useState(false);

  const hasSubmittedRef = useRef(false);
  const mismatchRef = useRef(0);
  const stabilizerRef = useRef(createViolationStabilizer());

  const continuousVerifyQuery = useContinuousVerify(
    sessionId,
    captureImage,
    isMonitoringStopped,
    isReady,
  );

  const { data, dataUpdatedAt } = continuousVerifyQuery;

  // Keyed on dataUpdatedAt, not on the response object: React Query hands back
  // the same reference when two polls agree, so identical consecutive
  // mismatches would otherwise never be counted.
  useEffect(() => {
    if (isMonitoringStopped || !dataUpdatedAt || !data) return;

    const report = (outcome, extra) =>
      recordViolationEvent({
        source: "face_match",
        type: "FACE_MISMATCH",
        outcome,
        frame_quality: data.frame_quality,
        ...extra,
      });

    // Camera still warming up or no frame captured — a technical gap, not an
    // identity mismatch.
    if (data.no_sample) {
      report("no_sample");
      return;
    }

    if (typeof data.frame_quality === "number" && data.frame_quality < MIN_FRAME_QUALITY) {
      report("inconclusive");
      return;
    }

    if (data.same_person === true) {
      stabilizerRef.current.reset();
      mismatchRef.current = 0;
      hasSubmittedRef.current = false;
      // Deferred so the setState isn't a direct synchronous call in the effect.
      queueMicrotask(() => setMismatchCount(0));
      return;
    }

    if (data.same_person !== false) return;

    if (!stabilizerRef.current.push({ type: "FACE_MISMATCH" })) {
      report("unconfirmed", { window: stabilizerRef.current.peek().FACE_MISMATCH ?? null });
      return;
    }

    stabilizerRef.current.commit("FACE_MISMATCH");
    mismatchRef.current += 1;
    queueMicrotask(() => setMismatchCount(mismatchRef.current));
    report("raised", { violation_count: mismatchRef.current });
  }, [data, dataUpdatedAt, isMonitoringStopped]);

  useEffect(() => {
    if (mismatchCount === 0) return;

    toast.error(`Face mismatch detected (${mismatchCount}/${FACE_MISMATCH_LIMIT})`);

    if (mismatchCount >= FACE_MISMATCH_LIMIT && !hasSubmittedRef.current) {
      hasSubmittedRef.current = true;
      setIsMonitoringStopped(true);

      recordViolationEvent({
        source: "face_match",
        type: "FACE_MISMATCH",
        outcome: "terminated",
        violation_count: mismatchCount,
      });

      // The termination notice explains this one; a toast underneath it would
      // just be noise.
      autoSubmit(TERMINATION_REASONS.FACE_MISMATCH);
    }
  }, [mismatchCount]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    mismatchCount,
    isMonitoringStopped,
    continuousVerifyQuery,
  };
};
