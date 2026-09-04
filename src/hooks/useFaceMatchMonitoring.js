import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useContinuousVerify } from "./useContinuousVerify";
import { FACE_MISMATCH_LIMIT } from "@/config/interview";
import { TERMINATION_REASONS } from "@/lib/terminationReasons";

export const useFaceMatchMonitoring = ({ sessionId, captureImage, autoSubmit, isReady = true }) => {
  const [mismatchCount, setMismatchCount] = useState(0);

  const [isMonitoringStopped, setIsMonitoringStopped] = useState(false);

  const hasSubmittedRef = useRef(false);

  const continuousVerifyQuery = useContinuousVerify(
    sessionId,
    captureImage,
    isMonitoringStopped,
    isReady,
  );

  const samePerson = continuousVerifyQuery.data?.same_person;

  useEffect(() => {
    if (isMonitoringStopped) return;

    // "No sample" (camera warming up, frame not captured) is a technical gap,
    // NOT an identity mismatch — skip the tick so it can't trigger a violation.
    if (continuousVerifyQuery.data?.no_sample) return;

    if (samePerson === false) {
      // Increment only on an explicit "different person" result from the backend.
      // Deferred so the setState isn't a direct synchronous call in the effect body.
      queueMicrotask(() => setMismatchCount((prev) => prev + 1));
    } else if (samePerson === true) {
      // Reset count on successful verification
      queueMicrotask(() => setMismatchCount(0));
      // Allow auto-submit again for future mismatches
      hasSubmittedRef.current = false;
    }
    // ignore undefined (initial) and other values
  }, [continuousVerifyQuery.data, samePerson, isMonitoringStopped]);

  useEffect(() => {
    if (mismatchCount === 0) return;

    toast.error(`Face mismatch detected (${mismatchCount}/${FACE_MISMATCH_LIMIT})`);

    if (mismatchCount >= FACE_MISMATCH_LIMIT && !hasSubmittedRef.current) {
      hasSubmittedRef.current = true;

      setIsMonitoringStopped(true);

      // The termination notice explains this one; a toast underneath it would
      // just be noise.
      autoSubmit(TERMINATION_REASONS.FACE_MISMATCH);

      setMismatchCount(0);

      hasSubmittedRef.current = false;
    }
  }, [mismatchCount]);

  return {
    mismatchCount,
    isMonitoringStopped,
    continuousVerifyQuery,
  };
};
