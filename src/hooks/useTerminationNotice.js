import { useCallback, useEffect, useState } from "react";
import { isTerminationReason } from "@/lib/terminationReasons";
import { TERMINATION_NOTICE_SECONDS } from "@/config/interview";

/**
 * Holds the final notice on screen long enough to be read, then proceeds on its
 * own. Submission is already running underneath by the time this shows, so the
 * countdown only gates what the candidate sees — it can't be used to stall.
 */
export function useTerminationNotice(reason) {
  const isTerminal = isTerminationReason(reason);
  const [acknowledged, setAcknowledged] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(TERMINATION_NOTICE_SECONDS);

  useEffect(() => {
    if (!isTerminal || acknowledged) return;

    const id = setInterval(() => {
      setSecondsLeft((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);

    return () => clearInterval(id);
  }, [isTerminal, acknowledged]);

  const acknowledge = useCallback(() => setAcknowledged(true), []);

  return {
    visible: isTerminal && !acknowledged && secondsLeft > 0,
    secondsLeft,
    acknowledge,
  };
}
