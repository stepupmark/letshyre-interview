import { lazy, Suspense, useEffect, useState, useRef, useCallback } from "react";
import { toast } from "sonner";

import Header from "@components/interview/Header";
import PostInterviewHeader from "@components/interview/PostInterviewHeader";
import LeftPanel from "@components/interview/LeftPanel";
import QuestionRenderer from "@components/interview/QuestionRenderer";
import ViolationWarning from "@components/interview/ViolationWarning";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Heavy result view — only needed once at the very end, so load it on demand.
const ScoreCard = lazy(() => import("@components/interview/ScoreCard"));
import AutoSubmitLoader from "@components/interview/AutoSubmitLoader";
import { InitialLoadingUi } from "@/components/interview/InitialLoadingUi";
import { TerminatedUi } from "@/components/interview/TerminatedUi";

import { useInterviewSession } from "@hooks/useInterviewSession";
import { useProctoringSystem } from "@hooks/useProctoringSystem";
import { useViolationMonitor } from "@/hooks/useViolationMonitor";
import { useElectronViolation } from "@/hooks/electron/useElectronViolation";
import { useInterviewComplete } from "@/hooks/electron/useInterviewComplete";
import { useElectronScreenRecording } from "@/hooks/electron/useElectronScreenRecording";
import { useRegisterFace } from "@/hooks/useRegisterFace";
import { useFaceMatchMonitoring } from "@/hooks/useFaceMatchMonitoring";
import { captureFrameFile, dataUrlToFile } from "@/lib/videoCapture";
import { logger } from "@/lib/logger";

export function Interview() {
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
  useInterviewComplete({ isCompleted, isTerminated, isExpired, autoSubmitSuccess });

  const { showTabWarning, violationInfo, dismissWarning, handleAiViolation, handleElectronViolation } =
    useViolationMonitor({
      isActive,
      incrementViolation,
      sessionViolations: session?.violations ?? 0,
    });

  // videoRef declared before captureImage to avoid TDZ risk.
  const videoRef = useRef(null);

  // Face match monitoring must not start until the reference face is registered.
  // Electron injects candidate_photo into sessionStorage before the interview
  // window boots (via webContents.executeJavaScript in the main process), so
  // this initializer is true immediately in kiosk mode.
  const [isFaceRegistered, setIsFaceRegistered] = useState(
    () => sessionStorage.getItem("face_registered") === "true",
  );

  const registerFaceMutation = useRegisterFace(session?.session_id);

  // Full-resolution frame as a File for face-match verification.
  const captureImage = useCallback(() => captureFrameFile(videoRef.current, "frame.jpg"), []);

  useFaceMatchMonitoring({
    sessionId: session?.session_id,
    captureImage,
    autoSubmit,
    isReady: isFaceRegistered,
  });

  // Register the reference face once per session. Electron pre-populates
  // sessionStorage('candidate_photo') before this page loads; the effect is
  // a no-op in environments where the photo was never stored.
  useEffect(() => {
    if (!session?.session_id) return;
    if (sessionStorage.getItem("face_registered") === "true") return;

    const storedPhoto = sessionStorage.getItem("candidate_photo");
    if (!storedPhoto) return;

    const file = dataUrlToFile(storedPhoto, "candidate.jpg");
    registerFaceMutation.mutate(
      { imageFile: file },
      {
        onSuccess: () => {
          sessionStorage.setItem("face_registered", "true");
          setIsFaceRegistered(true);
        },
      },
    );
  }, [session?.session_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Surface camera boot/playback failures to the candidate (previously a no-op
  // because the status callback was never wired through LeftPanel).
  const handleCameraStatus = useCallback((status) => {
    if (status === "engine-error") {
      toast.error("Camera unavailable. Check permissions/hardware — proctoring needs your camera.");
    }
  }, []);

  //Central Proctoring System
  const { isDegraded: isProctoringDegraded } = useProctoringSystem(
    videoRef,
    session?.interview_id,
    session?.session_id,
    isActive,
    session?.proctoring_token,
    handleAiViolation,
  );

  useEffect(() => {
    if (!isProctoringDegraded) return;
    toast.warning("Proctoring checks are temporarily unavailable.", {
      description: "Your session is still being recorded. Stay in front of the camera.",
    });
  }, [isProctoringDegraded]);

  useElectronViolation({
    onHardBlock: handleElectronViolation,
    onSoftBlock: handleElectronViolation,
  });

  useElectronScreenRecording({
    sessionId:         session?.session_id,
    interviewId:       session?.interview_id,
    isActive,
    isCompleted,
    isTerminated,
    isExpired,
    autoSubmitSuccess,
  });

  const question = session?.question || session?.next_question || null;

  //wrapped in useCallback + added error handling for network failures
  const handleSubmit = useCallback(
    async (payload) => {
      try {
        await submit(payload);
      } catch (err) {
        toast.error("Failed to submit answer. Please try again.");
        logger.error("[Interview] submit failed:", err);
      }
    },
    [submit],
  );

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
                <ScoreCard scorecard={session.scorecard} />
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
                <ErrorBoundary>
                  <QuestionRenderer
                    question={question}
                    onSubmit={handleSubmit}
                    questionNumber={session.current_index || 1}
                    endTime={session.end_time}
                    submitting={submitting}
                    isLastQuestion={session.current_index === session.total_questions}
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
        title={violationInfo.title}
        description={violationInfo.description}
        imagePath={violationInfo.imagePath}
      />
    </div>
  );
}
