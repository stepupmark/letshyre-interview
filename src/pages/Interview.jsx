import { lazy, Suspense, useEffect, useState, useRef, useCallback } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import Header from "@components/interview/Header";
import PostInterviewHeader from "@components/interview/PostInterviewHeader";
import LeftPanel from "@components/interview/LeftPanel";
import QuestionRenderer from "@components/interview/QuestionRenderer";
import ViolationWarning from "@components/interview/ViolationWarning";
import HeldViolationBanner from "@components/interview/HeldViolationBanner";
import FullscreenPrompt from "@components/interview/FullscreenPrompt";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Heavy result view — only needed once at the very end, so load it on demand.
const ScoreCard = lazy(() => import("@components/interview/ScoreCard"));
import AutoSubmitLoader from "@components/interview/AutoSubmitLoader";
import TerminationNotice from "@components/interview/TerminationNotice";
import { InitialLoadingUi } from "@/components/interview/InitialLoadingUi";
import { TerminatedUi } from "@/components/interview/TerminatedUi";

import { useInterviewSession } from "@hooks/interview/useInterviewSession";
import { useTerminationNotice } from "@hooks/interview/useTerminationNotice";
import { useProctoringSystem } from "@hooks/proctoring/useProctoringSystem";
import { useViolationMonitor } from "@hooks/proctoring/useViolationMonitor";
import { useFaceMatchMonitoring } from "@hooks/proctoring/useFaceMatchMonitoring";
import { useElectronViolation } from "@hooks/electron/useElectronViolation";
import { useInterviewComplete } from "@hooks/electron/useInterviewComplete";
import { useElectronScreenRecording } from "@hooks/electron/useElectronScreenRecording";
import { useRegisterFace } from "@mutations/useRegisterFace";
import { dataUrlToFile } from "@/lib/videoCapture";
import { logger } from "@/lib/logger";
import { TERMINATION_REASONS } from "@/lib/terminationReasons";
import { draftKeyFor } from "@/lib/answerDraft";
import { recordViolationEvent } from "@/lib/violationLog";

const FACE_REGISTERED_KEY = "face_registered_for";
const REGISTER_RETRY_MS = 15_000;
const UNVERIFIED_AFTER_MS = 60_000;

export function Interview() {
  const { t } = useTranslation("questions");
  const {
    session,
    submitting,
    submit,
    incrementViolation,
    isActive,
    isCompleted,
    isTerminated,
    isExpired,
    autoSubmitting,
    autoSubmitReason,
    autoSubmitSuccess,
    autoSubmitError,
    autoSubmit,
  } = useInterviewSession();

  // Signal Electron when session ends — lifts kiosk mode, restores close/minimize.
  // No-op when running in a regular browser (window.electronAPI absent).
  useInterviewComplete({
    isCompleted,
    isTerminated,
    isExpired,
    autoSubmitSuccess,
    autoSubmitReason,
  });

  const {
    showTabWarning,
    violationInfo,
    alsoDetected,
    heldViolations,
    strikes,
    securityBlock,
    dismissWarning,
    needsFullscreen,
    restoreFullscreen,
    handleAiViolation,
    handleElectronViolation,
    handleElectronHardBlock,
  } = useViolationMonitor({
    isActive,
    incrementViolation,
    sessionViolations: session?.violations ?? 0,
    sessionId: session?.session_id,
    onHardBlock: () => autoSubmit(TERMINATION_REASONS.ELECTRON_SECURITY),
  });

  const videoRef = useRef(null);

  // Keyed by session: the desktop app reuses one window across interviews, so a
  // bare flag left over from the last one skipped registering the next.
  const [registeredFor, setRegisteredFor] = useState(() =>
    sessionStorage.getItem(FACE_REGISTERED_KEY),
  );
  const [registerRequest, setRegisterRequest] = useState(0);
  const [registerFailures, setRegisterFailures] = useState(0);
  const isFaceRegistered = !!session?.session_id && registeredFor === session.session_id;

  const registerFaceMutation = useRegisterFace(session?.session_id);

  const reregisterFace = useCallback(() => {
    sessionStorage.removeItem(FACE_REGISTERED_KEY);
    setRegisteredFor(null);
    setRegisterRequest((n) => n + 1);
  }, []);

  // The two hooks need each other: verification asks the camera loop for a
  // quicker look, and the loop feeds verification its frames.
  const sampleSoonRef = useRef(null);
  const requestSample = useCallback((reason) => sampleSoonRef.current?.(reason), []);

  const { verifySample, isVerificationUnavailable } = useFaceMatchMonitoring({
    sessionId: session?.session_id,
    autoSubmit,
    onViolation: handleAiViolation,
    onNotRegistered: reregisterFace,
    requestSample,
    isReady: isFaceRegistered,
  });

  // The desktop app puts candidate_photo in sessionStorage before this page
  // loads. Without it there is nothing to register.
  useEffect(() => {
    const sessionId = session?.session_id;
    if (!sessionId || sessionStorage.getItem(FACE_REGISTERED_KEY) === sessionId) return;
    sessionStorage.removeItem("face_registered");

    const storedPhoto = sessionStorage.getItem("candidate_photo");
    if (!storedPhoto) return;

    registerFaceMutation.mutate(
      { imageFile: dataUrlToFile(storedPhoto, "candidate.jpg") },
      {
        onSuccess: () => {
          sessionStorage.setItem(FACE_REGISTERED_KEY, sessionId);
          setRegisteredFor(sessionId);
        },
        onError: (err) => {
          logger.error("[Interview] face registration failed:", err?.message);
          recordViolationEvent({
            source: "face_match",
            type: "FACE_MISMATCH",
            outcome: "registration_failed",
            error: err?.response?.status ?? err?.message,
          });
          setRegisterFailures((n) => n + 1);
        },
      },
    );
  }, [session?.session_id, registerRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!registerFailures || !isActive || isFaceRegistered) return;
    const id = setTimeout(() => setRegisterRequest((n) => n + 1), REGISTER_RETRY_MS);
    return () => clearTimeout(id);
  }, [registerFailures, isActive, isFaceRegistered]);

  // Flagged for review rather than ended: a missing reference face is our
  // failure, not the candidate's.
  useEffect(() => {
    if (!isActive || isFaceRegistered) return;
    const id = setTimeout(() => {
      recordViolationEvent({
        source: "face_match",
        type: "FACE_MISMATCH",
        outcome: "identity_unverified",
        reason: sessionStorage.getItem("candidate_photo")
          ? "registration_failed"
          : "no_reference_photo",
      });
    }, UNVERIFIED_AFTER_MS);
    return () => clearTimeout(id);
  }, [isActive, isFaceRegistered]);

  // Surface camera boot/playback failures to the candidate (previously a no-op
  // because the status callback was never wired through LeftPanel).
  const handleCameraStatus = useCallback((status) => {
    if (status === "engine-error") {
      toast.error("Camera unavailable. Check permissions/hardware — proctoring needs your camera.");
    }
  }, []);

  // Owns the only camera clock; face verification reads the frames it samples.
  const { isDegraded: isProctoringDegraded, sampleSoon } = useProctoringSystem(
    videoRef,
    session?.interview_id,
    session?.session_id,
    isActive,
    session?.proctoring_token,
    handleAiViolation,
    verifySample,
  );

  useEffect(() => {
    sampleSoonRef.current = sampleSoon;
  }, [sampleSoon]);

  const {
    visible: showTermination,
    secondsLeft: terminationSecondsLeft,
    acknowledge: acknowledgeTermination,
  } = useTerminationNotice(autoSubmitReason);

  // requestFullscreen only works from a user gesture, so when the warning closes
  // itself the candidate has to be given something to click.
  useEffect(() => {
    if (!needsFullscreen) return;

    const id = toast.custom(
      (toastId) => (
        <FullscreenPrompt
          onRestore={() => {
            toast.dismiss(toastId);
            restoreFullscreen();
          }}
        />
      ),
      { duration: Infinity },
    );

    return () => toast.dismiss(id);
  }, [needsFullscreen, restoreFullscreen]);

  useEffect(() => {
    if (!isProctoringDegraded && !isVerificationUnavailable) return;
    toast.warning("Proctoring checks are temporarily unavailable.", {
      id: "proctoring-unavailable",
      description: "Your session is still being recorded. Stay in front of the camera.",
    });
  }, [isProctoringDegraded, isVerificationUnavailable]);

  useElectronViolation({
    onHardBlock: handleElectronHardBlock,
    onSoftBlock: handleElectronViolation,
  });

  useElectronScreenRecording({
    sessionId: session?.session_id,
    interviewId: session?.interview_id,
    isActive,
    isCompleted,
    isTerminated,
    isExpired,
    autoSubmitSuccess,
  });

  const question = session?.question || session?.next_question || null;

  const handleSubmit = useCallback(
    async function send(payload) {
      try {
        await submit(payload);
        toast.dismiss("submit-failed");
      } catch (err) {
        logger.error("[Interview] submit failed:", err);
        toast.error(t("shell.submitFailed"), {
          id: "submit-failed",
          description: err?.response?.data?.message,
          duration: Infinity,
          action: { label: t("shell.retry"), onClick: () => send(payload) },
        });
      }
    },
    [submit, t],
  );

  // Sits above the loader: submission is already running underneath, so this
  // only holds the explanation on screen long enough to be read.
  if (showTermination) {
    return (
      <TerminationNotice
        reason={autoSubmitReason}
        secondsLeft={terminationSecondsLeft}
        onAcknowledge={acknowledgeTermination}
        strikes={strikes}
        securityBlock={securityBlock}
      />
    );
  }

  if (autoSubmitting) {
    return (
      <AutoSubmitLoader
        reason={autoSubmitReason}
        isSuccess={autoSubmitSuccess}
        error={autoSubmitError}
        onRetry={() => autoSubmit(autoSubmitReason)}
      />
    );
  }

  if (!session) {
    return <InitialLoadingUi />;
  }

  if (isTerminated) {
    return <TerminatedUi />;
  }

  const sessionEnded = isCompleted || isExpired;

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#7fb0ff_0%,#cfe1ff_38%,#eef5ff_72%,#ffffff_100%)]">
      {sessionEnded ? (
        <PostInterviewHeader />
      ) : (
        <Header
          attempted={session.current_index}
          total={session.total_questions}
          violations={session?.violations || 0}
        />
      )}

      {isCompleted || isExpired ? (
        <main className="mx-auto h-[calc(100vh-80px)] w-full overflow-y-auto px-8 py-6">
          {session?.scorecard ? (
            <ErrorBoundary>
              <Suspense fallback={null}>
                <ScoreCard scorecard={session.scorecard} endReason={session.end_reason} />
              </Suspense>
            </ErrorBoundary>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-blue-100">
                <svg
                  className="h-10 w-10 text-blue-500 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              </div>
              <div>
                <h2 className="text-2xl font-bold text-slate-800">Interview Completed!</h2>
                <p className="mt-2 text-slate-500 font-medium">
                  Your scorecard is being generated… Please wait.
                </p>
              </div>
            </div>
          )}
        </main>
      ) : (
        <main className="h-[calc(100vh-80px)] overflow-hidden bg-[#dfe8f7] p-6">
          <div
            className="grid h-full gap-6"
            style={{
              gridTemplateColumns: "clamp(320px, 22vw, 420px) 1fr",
            }}
          >
            {/* LEFT PANEL */}
            <aside className="min-w-0">
              <div className="sticky top-0 flex h-full flex-col rounded-[28px] bg-[#d9e5fb] p-4">
                <LeftPanel videoRef={videoRef} onCameraStatus={handleCameraStatus} />
              </div>
            </aside>

            {/* RIGHT PANEL */}
            <section className="min-w-0 overflow-y-auto">
              <div className="min-h-full rounded-[28px] bg-[#f5f7fc] p-6 shadow-sm">
                {!showTabWarning && <HeldViolationBanner items={heldViolations} />}
                <ErrorBoundary>
                  <QuestionRenderer
                    question={question}
                    onSubmit={handleSubmit}
                    questionNumber={session.current_index || 1}
                    endTime={session.end_time}
                    submitting={submitting}
                    isLastQuestion={session.current_index === session.total_questions}
                    draftKey={draftKeyFor(session)}
                  />
                </ErrorBoundary>
              </div>
            </section>
          </div>
        </main>
      )}

      <ViolationWarning
        isOpen={showTabWarning}
        onClose={dismissWarning}
        violationCount={violationInfo.violationCount}
        counts={violationInfo.counts}
        titleKey={violationInfo.titleKey}
        descriptionKey={violationInfo.descriptionKey}
        imagePath={violationInfo.imagePath}
        label={violationInfo.label}
        labels={violationInfo.labels}
        finalWarning={violationInfo.finalWarning}
        alsoDetected={alsoDetected}
      />
    </div>
  );
}
