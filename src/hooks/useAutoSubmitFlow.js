import { useEffect, useState } from "react";
import { useAutoSubmitMutation } from "@mutations/useAutoSubmitMutation";
import { MAX_INTERNET_DISCONNECTS, SESSION_STATUS } from "@/config/interview";
import { TERMINATION_REASONS } from "@/lib/terminationReasons";
import { logger } from "@/lib/logger";

/**
 * Owns the auto-submit flow: the async submit-and-freeze-session action plus
 * every trigger condition that can fire it (timer expiry, violation/disconnect
 * limits, a restored expired session, and retry-on-reconnect). Split out of
 * useInterviewSession so that hook stays focused on session lifecycle/CRUD;
 * this one owns everything downstream of "submission is due".
 */
export function useAutoSubmitFlow({ session, setSession, timeLeft, violationsAllowed }) {
  const autoSubmitMutation = useAutoSubmitMutation();
  const [autoSubmitting, setAutoSubmitting] = useState(false);
  const [autoSubmitReason, setAutoSubmitReason] = useState("");
  const [autoSubmitSuccess, setAutoSubmitSuccess] = useState(false);
  const [autoSubmitError, setAutoSubmitError] = useState(null);

  /**
   * Auto-submit interview session when trigger conditions are met
   */
  const autoSubmit = async (reason) => {
    // Allow retry if there was an error
    if (
      !session ||
      (session.status !== SESSION_STATUS.ACTIVE && session.status !== SESSION_STATUS.EXPIRED) ||
      (autoSubmitting && !autoSubmitError)
    )
      return;

    try {
      setAutoSubmitting(true);
      setAutoSubmitError(null);
      setAutoSubmitSuccess(false);
      setAutoSubmitReason(reason || "Automated submission");
      logger.log(`[AutoSubmit] 🚨 Triggering auto-submit. Reason: ${reason}`);

      // Stop the session first by setting status to EXPIRED.
      // This will freeze the timer and automatically trigger the proctoring logs flush queue.
      if (session.status === SESSION_STATUS.ACTIVE) {
        setSession((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            status: SESSION_STATUS.EXPIRED,
          };
        });
      }

      const requestData = {
        interview_id: session.interview_id,
        session_id: session.session_id,
      };

      const response = await autoSubmitMutation.mutateAsync(requestData);

      if (!response?.success || !response?.data) {
        throw new Error("Invalid auto submit response");
      }

      const aiData = response.data.ai;
      const scorecard = aiData?.scorecard || response.data.scorecard || null;

      logger.log("[AutoSubmit] ✅ Auto-submit response parsed successfully.", response.data);

      setAutoSubmitSuccess(true);

      // Let the success UI animation run smoothly
      await new Promise((resolve) => setTimeout(resolve, 1500));

      setSession((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          ...aiData,
          question: null,
          ...(scorecard ? { scorecard } : {}),
          status: SESSION_STATUS.COMPLETED,
        };
      });
      setAutoSubmitting(false);
    } catch (error) {
      logger.error("[AutoSubmit] ❌ Auto submit failed:", error);
      // Surface the real reason. Only attribute it to connectivity when the
      // browser is actually offline; otherwise pass the server/error message
      // through so the UI doesn't mislabel a server failure as "no internet".
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      const serverMessage = error?.response?.data?.message || error?.message;
      setAutoSubmitError(
        offline
          ? "You appear to be offline. We'll submit automatically once you're back online."
          : serverMessage || "Submission failed. Please try again.",
      );
    }
  };

  /**
   * Auto-expire session when the timer runs out
   */
  useEffect(() => {
    if (!session) return;

    if (session.status !== SESSION_STATUS.ACTIVE) {
      return;
    }

    if (timeLeft > 0) {
      return;
    }

    queueMicrotask(() => autoSubmit(TERMINATION_REASONS.TIME_EXPIRED));
  }, [timeLeft, session?.status]);

  /**
   * Auto-submit when violations strikes reach limit
   * NOTE: This only tracks proctoring violations (tab switch, fullscreen exit,
   *       window resize, AI-detected object violations). Internet disconnects
   *       are tracked separately via internet_disconnect_count.
   */
  useEffect(() => {
    if (!session) return;
    if (session.status !== SESSION_STATUS.ACTIVE) return;

    if ((session.violations || 0) >= violationsAllowed) {
      queueMicrotask(() => autoSubmit(TERMINATION_REASONS.VIOLATION_LIMIT));
    }
  }, [session?.violations, session?.status]);

  /**
   * Auto-submit when the internet disconnect count reaches its limit.
   * This is a SEPARATE category from proctoring violations.
   */
  useEffect(() => {
    if (!session) return;
    if (session.status !== SESSION_STATUS.ACTIVE) return;

    if ((session.internet_disconnect_count || 0) >= MAX_INTERNET_DISCONNECTS) {
      logger.log(
        `[Network] 🚨 ${MAX_INTERNET_DISCONNECTS} internet disconnects reached — triggering auto-submit.`,
      );
      queueMicrotask(() => autoSubmit(TERMINATION_REASONS.NETWORK_DISCONNECTS));
    }
  }, [session?.internet_disconnect_count, session?.status]);

  /**
   * Auto-submit if session is restored/loaded in EXPIRED state but has no scorecard
   */
  useEffect(() => {
    if (!session) return;
    if (session.status === SESSION_STATUS.EXPIRED && !session.scorecard && !autoSubmitting) {
      logger.log(
        "[useAutoSubmitFlow] Restored expired session without scorecard. Auto-submitting...",
      );
      queueMicrotask(() => autoSubmit(autoSubmitReason || "Resuming expired session"));
    }
  }, [session?.status, session?.scorecard]);

  /**
   * Auto-retry auto-submit when internet comes back online after a failure.
   * This handles the case where auto-submit was triggered while offline
   * (e.g., 3 internet disconnects) and the API call failed.
   */
  useEffect(() => {
    if (!autoSubmitError) return;

    const handleOnlineRetry = () => {
      logger.log("[Network] 🔄 Internet restored — automatically retrying auto-submit...");
      autoSubmit(autoSubmitReason || "Retrying after reconnection");
    };

    window.addEventListener("online", handleOnlineRetry);
    return () => window.removeEventListener("online", handleOnlineRetry);
  }, [autoSubmitError, autoSubmitReason]);

  return {
    autoSubmitting,
    autoSubmitReason,
    autoSubmitSuccess,
    autoSubmitError,
    autoSubmit,
  };
}
