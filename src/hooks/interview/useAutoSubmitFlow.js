import { useEffect, useRef, useState } from "react";
import { useAutoSubmitMutation } from "@mutations/useAutoSubmitMutation";
import { MAX_INTERNET_DISCONNECTS, SESSION_STATUS } from "@/config/interview";
import { TERMINATION_REASONS, toEndReason } from "@/lib/terminationReasons";
import { logger } from "@/lib/logger";
import { clearDrafts, draftKeyFor, readDraft } from "@/lib/answerDraft";

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

  // Guards against a double submit, and has to be a ref rather than the
  // autoSubmitting state: when several triggers fire in the same commit their
  // queued microtasks all run before React flushes setAutoSubmitting, so each
  // one would still read `false` and submit. Cleared on failure so a retry can
  // get through.
  const submitInFlightRef = useRef(false);

  /**
   * Auto-submit interview session when trigger conditions are met
   */
  const autoSubmit = async (reason) => {
    if (
      !session ||
      (session.status !== SESSION_STATUS.ACTIVE && session.status !== SESSION_STATUS.EXPIRED) ||
      submitInFlightRef.current
    )
      return;

    submitInFlightRef.current = true;

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
      const draft = readDraft(draftKeyFor(session));
      if (draft.trim()) requestData.answer = draft;

      const response = await autoSubmitMutation.mutateAsync(requestData);

      if (!response?.success || !response?.data) {
        throw new Error("Invalid auto submit response");
      }

      const aiData = response.data.ai;
      const scorecard = aiData?.scorecard || response.data.scorecard || null;
      const endReason = toEndReason(reason, {
        terminated: aiData?.terminated === true,
        timeUp: session.end_time <= Date.now(),
      });

      logger.log("[AutoSubmit] ✅ Auto-submit response parsed successfully.", response.data);

      clearDrafts();
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
          end_reason: endReason,
          status: SESSION_STATUS.COMPLETED,
        };
      });
      setAutoSubmitting(false);
    } catch (error) {
      submitInFlightRef.current = false;
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

  const autoSubmitRef = useRef(autoSubmit);
  useEffect(() => {
    autoSubmitRef.current = autoSubmit;
  });

  const isSessionActive = session?.status === SESSION_STATUS.ACTIVE;
  const isSessionExpired = session?.status === SESSION_STATUS.EXPIRED;
  const violations = session?.violations ?? 0;
  const disconnectCount = session?.internet_disconnect_count ?? 0;
  const hasScorecard = Boolean(session?.scorecard);

  /**
   * Auto-expire session when the timer runs out
   */
  useEffect(() => {
    if (!isSessionActive || timeLeft > 0) {
      return;
    }

    queueMicrotask(() => autoSubmitRef.current(TERMINATION_REASONS.TIME_EXPIRED));
  }, [timeLeft, isSessionActive]);

  /**
   * Auto-submit when violations strikes reach limit
   * NOTE: This only tracks proctoring violations (tab switch, fullscreen exit,
   *       window resize, AI-detected object violations). Internet disconnects
   *       are tracked separately via internet_disconnect_count.
   */
  useEffect(() => {
    if (!isSessionActive) return;

    if (violations >= violationsAllowed) {
      queueMicrotask(() => autoSubmitRef.current(TERMINATION_REASONS.VIOLATION_LIMIT));
    }
  }, [isSessionActive, violations, violationsAllowed]);

  /**
   * Auto-submit when the internet disconnect count reaches its limit.
   * This is a SEPARATE category from proctoring violations.
   */
  useEffect(() => {
    if (!isSessionActive) return;

    if (disconnectCount >= MAX_INTERNET_DISCONNECTS) {
      logger.log(
        `[Network] 🚨 ${MAX_INTERNET_DISCONNECTS} internet disconnects reached — triggering auto-submit.`,
      );
      queueMicrotask(() => autoSubmitRef.current(TERMINATION_REASONS.NETWORK_DISCONNECTS));
    }
  }, [isSessionActive, disconnectCount]);

  /**
   * Auto-submit if session is restored/loaded in EXPIRED state but has no scorecard
   */
  useEffect(() => {
    if (!isSessionExpired || hasScorecard || autoSubmitting) return;

    logger.log(
      "[useAutoSubmitFlow] Restored expired session without scorecard. Auto-submitting...",
    );
    queueMicrotask(() => autoSubmitRef.current(autoSubmitReason || "Resuming expired session"));
  }, [isSessionExpired, hasScorecard, autoSubmitting, autoSubmitReason]);

  /**
   * Auto-retry auto-submit when internet comes back online after a failure.
   * This handles the case where auto-submit was triggered while offline
   * (e.g., 3 internet disconnects) and the API call failed.
   */
  useEffect(() => {
    if (!autoSubmitError) return;

    const handleOnlineRetry = () => {
      logger.log("[Network] 🔄 Internet restored — automatically retrying auto-submit...");
      autoSubmitRef.current(autoSubmitReason || "Retrying after reconnection");
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
