import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useStartInterviewMutation } from "@mutations/useStartInterviewMutation";
import { useSubmitAnswerMutation } from "@mutations/useSubmitAnswerMutation";
import { useAutoSubmitFlow } from "./useAutoSubmitFlow";
import {
  MAX_VIOLATIONS,
  INTERVIEW_DURATION_MINUTES,
  INTERVIEW_SESSION_STORAGE_KEY,
  SESSION_STATUS,
} from "@/config/interview";
import { logger } from "@/lib/logger";

const STORAGE_KEY = INTERVIEW_SESSION_STORAGE_KEY;

const INTERVIEW_DURATION_MS = INTERVIEW_DURATION_MINUTES * 60 * 1000;

const VIOLATIONS_ALLOWED = MAX_VIOLATIONS;

function isValidSession(session) {
  if (!session || typeof session !== "object") {
    return false;
  }

  return (
    (typeof session.interview_id === "string" || typeof session.interview_id === "number") &&
    (typeof session.session_id === "string" || typeof session.session_id === "number") &&
    typeof session.end_time === "number" &&
    typeof session.status === "string"
  );
}

export function useInterviewSession() {
  const [session, setSession] = useState(null);

  const [loading, setLoading] = useState(true);

  // Only used to rerender timer every second
  const [now, setNow] = useState(() => Date.now());

  // The role decision made on the Electron role-selection page is injected into
  // sessionStorage ('role_selection') before React boots — it survives the "/"→
  // "/interview" redirect that strips URL query params. Falls back to legacy URL
  // params for any non-Electron web entry.
  //   Yes (keep assigned role) → { is_custom_role: false }
  //   No  (chose a new role)   → { is_custom_role: true, selected_role[], manual_skills[] }
  const roleSelection = useMemo(() => {
    try {
      const raw = sessionStorage.getItem("role_selection");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return parsed;
      }
    } catch {
      // malformed injected value — fall through to legacy params
    }

    // Legacy fallback: role + skills via URL query params (older web flow).
    const params = new URLSearchParams(window.location.search);
    const role = params.get("role") || "";
    let skills = [];
    const rawSkills = params.get("skills");
    if (rawSkills) {
      try {
        const parsed = JSON.parse(rawSkills);
        if (Array.isArray(parsed)) skills = parsed;
      } catch {
        // malformed param — ignore silently
      }
    }
    return {
      is_custom_role: true,
      ...(role ? { selected_role: [role] } : {}),
      ...(skills.length ? { manual_skills: skills } : {}),
    };
  }, []);

  const startMutation = useStartInterviewMutation();

  const submitMutation = useSubmitAnswerMutation();

  /**
   * Prevent duplicate initialization
   * especially in React StrictMode
   */
  const hasInitializedRef = useRef(false);

  /**
   * Persist session automatically
   */
  useEffect(() => {
    // Skip saving/clearing on initial mount while loading
    if (loading && !session) return;

    if (!session) {
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }

    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }, [session, loading]);

  /**
   * Start interview session
   */
  const startNewSession = async () => {
    try {
      setLoading(true);

      // Build the start payload from the role decision.
      //   is_custom_role:false → send only the flag; backend uses the assigned role.
      //   is_custom_role:true  → include the chosen role(s) + manual skills.
      let payload;
      if (roleSelection?.is_custom_role === false) {
        payload = { is_custom_role: false };
      } else {
        payload = { is_custom_role: true };
        const roles = roleSelection?.selected_role;
        const skills = roleSelection?.manual_skills;
        if (Array.isArray(roles) && roles.length > 0) payload.selected_role = roles;
        if (Array.isArray(skills) && skills.length > 0) payload.manual_skills = skills;
      }

      const response = await startMutation.mutateAsync(payload);

      if (!response?.success || !response?.data) {
        throw new Error("Invalid start session response");
      }

      const initialSession = response.data;

      const nextSession = {
        interview_id: initialSession.interview_id,
        session_id: initialSession.session_id,
        proctoring_token: initialSession.proctoring_token, // Capture the proctoring token
        ...initialSession.ai,
        question: initialSession.ai?.question || null,
        violations: 0,
        internet_disconnect_count: 0,
        end_time: Date.now() + INTERVIEW_DURATION_MS,
        status: SESSION_STATUS.ACTIVE,
      };

      setSession(nextSession);

      return nextSession;
    } catch (error) {
      logger.error("Failed to start interview session:", error);

      return null;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Initialize session ONCE
   */
  useEffect(() => {
    if (hasInitializedRef.current) {
      return;
    }

    hasInitializedRef.current = true;

    const initializeSession = async () => {
      try {
        const savedSession = sessionStorage.getItem(STORAGE_KEY);

        /**
         * Restore existing session
         */
        if (savedSession) {
          try {
            const parsed = JSON.parse(savedSession);

            if (!isValidSession(parsed)) {
              throw new Error("Invalid session schema");
            }

            /**
             * Terminal session — a finished interview (completed, terminated, or
             * already carrying a scorecard) must never be "resumed". Otherwise a
             * new attempt reloaded in the same Electron tab would restore the old
             * scorecard instead of starting fresh. Clear it and fall through to
             * startNewSession().
             */
            const isTerminal =
              parsed.status === SESSION_STATUS.COMPLETED ||
              parsed.status === SESSION_STATUS.TERMINATED ||
              Boolean(parsed.scorecard);

            if (!isTerminal) {
              /**
               * Expired session recovery — an ACTIVE session whose time ran out
               * while away is restored as EXPIRED so auto-submit can finish it.
               */
              if (parsed.end_time <= Date.now()) {
                setSession({
                  ...parsed,
                  status: SESSION_STATUS.EXPIRED,
                });

                return;
              }

              setSession(parsed);

              return;
            }

            // Terminal — discard and start a fresh interview below.
            sessionStorage.removeItem(STORAGE_KEY);
          } catch (error) {
            logger.error("Invalid saved session:", error);

            sessionStorage.removeItem(STORAGE_KEY);
          }
        }

        /**
         * No valid session found
         * start fresh session
         */
        await startNewSession();
      } finally {
        setLoading(false);
      }
    };

    initializeSession();
  }, []);

  /**
   * Stable real-time timer
   */
  useEffect(() => {
    if (!session?.end_time) {
      return;
    }

    if (session.status !== SESSION_STATUS.ACTIVE) {
      return;
    }

    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [session?.end_time, session?.status]);

  /**
   * Derived remaining time
   */
  const timeLeft = useMemo(() => {
    if (!session?.end_time) {
      return 0;
    }

    return Math.max(0, Math.floor((session.end_time - now) / 1000));
  }, [session?.end_time, now]);

  /**
   * Auto-submit flow: the submit action itself plus every trigger condition
   * that can fire it (timer expiry, violation/disconnect limits, restored
   * expired sessions, retry-on-reconnect). See useAutoSubmitFlow.
   */
  const { autoSubmitting, autoSubmitReason, autoSubmitSuccess, autoSubmitError, autoSubmit } =
    useAutoSubmitFlow({
      session,
      setSession,
      timeLeft,
      violationsAllowed: VIOLATIONS_ALLOWED,
    });

  /**
   * Listen to network connectivity offline/online events.
   * Only tracks disconnect count and shows toasts. Auto-submit is
   * triggered reactively by useAutoSubmitFlow's internet_disconnect_count effect.
   */
  useEffect(() => {
    if (!session || session.status !== SESSION_STATUS.ACTIVE) return;

    const handleOffline = () => {
      setSession((prev) => {
        if (!prev || prev.status !== SESSION_STATUS.ACTIVE) return prev;

        const newCount = (prev.internet_disconnect_count || 0) + 1;
        logger.warn(`[Network] ⚠️ Offline event fired. Disconnection count: ${newCount}`);

        toast.error(`Internet disconnected! (Strike ${newCount} of 3)`, {
          description:
            "Your interview will be automatically submitted if your connection drops 3 times.",
          duration: 7000,
        });

        return {
          ...prev,
          internet_disconnect_count: newCount,
        };
      });
    };

    const handleOnline = () => {
      toast.success("Internet reconnected! You can safely proceed with your interview.");
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [session?.status, session?.interview_id, session?.session_id]);

  /**
   * Mirror the committed violation count in a ref so concurrent increments
   * (two violations firing before a re-render) can't read the same stale base
   * and clobber each other. Re-synced after every commit that changes it.
   */
  const violationsRef = useRef(session?.violations ?? 0);
  useEffect(() => {
    violationsRef.current = session?.violations ?? 0;
  }, [session?.violations]);

  /**
   * Increment violations
   */
  const incrementViolation = useCallback(() => {
    if (!session || session.status !== SESSION_STATUS.ACTIVE) {
      return 0;
    }
    // Claim the next count off the ref synchronously, so a second call in the
    // same tick builds on this one instead of re-reading a stale value.
    const next = (violationsRef.current || 0) + 1;
    violationsRef.current = next;
    setSession((prev) => {
      if (!prev || prev.status !== SESSION_STATUS.ACTIVE) return prev;
      return {
        ...prev,
        violations: next,
      };
    });
    return next;
  }, [session]);

  /**
   * Terminate session manually
   */
  const terminateSession = useCallback(() => {
    setSession((prev) => {
      if (!prev) return prev;

      if (prev.status !== SESSION_STATUS.ACTIVE) {
        return prev;
      }

      return {
        ...prev,
        status: SESSION_STATUS.TERMINATED,
      };
    });
  }, []);

  /**
   * Submit answer
   */
  const submit = useCallback(async (payload) => {
    if (!session) return;

    if (session.status !== SESSION_STATUS.ACTIVE) {
      return;
    }

    try {
      const requestData = {
        interview_id: session.interview_id,
        session_id: session.session_id,
      };

      if (payload.audio_blob) {
        // Convert blob to base64 data-URL
        const base64Audio = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(payload.audio_blob);
        });
        requestData.audio_file = base64Audio;
      }

      if (payload.answer_text !== undefined) {
        requestData.answer = payload.answer_text;
      }

      if (payload.selected_option !== undefined) {
        requestData.answer = payload.selected_option;
      }

      const response = await submitMutation.mutateAsync(requestData);

      if (!response?.success || !response?.data) {
        throw new Error("Invalid submit response");
      }

      const aiData = response.data.ai;
      // scorecard is nested inside `ai` in this response
      const scorecard = aiData?.scorecard || response.data.scorecard || null;
      const isCompleted = !!(aiData?.completed || aiData?.is_completed);

      setSession((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          ...aiData,
          question: aiData?.next_question || null,
          // Persist scorecard into session state so ScoreCard can render it
          ...(isCompleted && scorecard ? { scorecard } : {}),
          status: isCompleted ? SESSION_STATUS.COMPLETED : prev.status,
        };
      });
    } catch (error) {
      logger.error("Failed to submit answer:", error);
      // Rethrow so callers (handleSubmit) can surface a toast to the candidate.
      throw error;
    }
  }, [session, submitMutation]);

  /**
   * Formatted timer
   */
  const formattedTime = useMemo(() => {
    const minutes = Math.floor(timeLeft / 60)
      .toString()
      .padStart(2, "0");

    const seconds = (timeLeft % 60).toString().padStart(2, "0");

    return `${minutes}:${seconds}`;
  }, [timeLeft]);

  return {
    session,
    loading: loading || startMutation.isPending,
    submitting: submitMutation.isPending || autoSubmitting,
    submit,
    timeLeft,
    formattedTime,
    incrementViolation,
    terminateSession,
    isExpired: session?.status === SESSION_STATUS.EXPIRED,
    isCompleted: session?.status === SESSION_STATUS.COMPLETED,
    isTerminated: session?.status === SESSION_STATUS.TERMINATED,
    isActive: session?.status === SESSION_STATUS.ACTIVE,
    autoSubmitting,
    autoSubmitReason,
    autoSubmitSuccess,
    autoSubmitError,
    autoSubmit,
  };
}
