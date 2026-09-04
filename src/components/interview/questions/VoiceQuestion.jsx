import { useEffect, useRef, useCallback } from "react";
import {
  AlertCircle,
  CheckCircle2,
  XCircle,
  Lightbulb,
  Loader2,
  Mic,
  ShieldCheck,
  Square,
  Play,
  Pause,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import QuestionShell from "../QuestionShell";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { useVoiceEnrollment } from "@/hooks/useVoiceEnrollment";
import { useVoiceCompare } from "@/hooks/useVoiceCompare";

// ─── Voice Comparison Result Banner ──────────────────────────────────────────

function VoiceCompareResult({ isComparing, result }) {
  const { t } = useTranslation("questions");

  if (isComparing) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 px-5 py-4 animate-in fade-in duration-300">
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-blue-500" />
        <p className="text-[14px] font-semibold text-blue-700">
          {t("voice.verifying")}
        </p>
      </div>
    );
  }

  if (!result) return null;

  const isMatch = result.matched === true;
  const score = result.score ?? "—";

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border px-5 py-4 animate-in fade-in slide-in-from-top-2 duration-500",
        isMatch
          ? "border-emerald-200 bg-emerald-50"
          : "border-amber-200 bg-amber-50"
      )}
    >
      <div className="mt-0.5 shrink-0">
        {isMatch ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
        ) : (
          <XCircle className="h-5 w-5 text-amber-600" />
        )}
      </div>
      <div className="space-y-0.5">
        <p
          className={cn(
            "text-[14px] font-bold",
            isMatch ? "text-emerald-800" : "text-amber-800"
          )}
        >
          {isMatch ? t("voice.verified") : t("voice.mismatchDetected")}
        </p>
        <p
          className={cn(
            "text-[13px] font-medium",
            isMatch ? "text-emerald-600" : "text-amber-600"
          )}
        >
          {isMatch
            ? t("voice.matchResult", { score })
            : t("voice.mismatchResult", { score })}
        </p>
      </div>
    </div>
  );
}

// ─── Enrollment Badge ─────────────────────────────────────────────────────────

function EnrollmentBadge({ isEnrolling, isEnrolled }) {
  const { t } = useTranslation("questions");

  if (isEnrolling) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[12px] font-semibold text-blue-600">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t("voice.enrolling")}
      </span>
    );
  }
  if (isEnrolled) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[12px] font-semibold text-emerald-600">
        <ShieldCheck className="h-3 w-3" />
        {t("voice.enrolled")}
      </span>
    );
  }
  return null;
}

// ─── Main VoiceQuestion Component ────────────────────────────────────────────

export default function VoiceQuestion({
  question,
  onSubmit,
  questionNumber,
  endTime,
  submitting,
  isLastQuestion,
}) {
  const { t } = useTranslation("questions");
  // Native MediaRecorder (audio/webm;opus, audio/mp4 on Safari). The blob is sent
  // as-is — no client-side MP3 encoding (removes the broken lamejs dependency).
  const recorder = useAudioRecorder();
  const isRecording = recorder.status === "recording";
  const audioRecorded = recorder.status === "reviewing" && !!recorder.audioBlob;

  // ── Voice Enrollment (once per session) ────────────────────────────────────
  const { enroll, isEnrolling, isEnrolled, enrollmentId } = useVoiceEnrollment();

  useEffect(() => {
    if (!isEnrolled && !isEnrolling) {
      enroll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally run only once on mount

  // ── Voice Comparison ────────────────────────────────────────────────────────
  const { compare, isComparing, compareResult, reset: resetCompare } = useVoiceCompare(
    (data) => {
      if (!data?.data?.matched) {
        toast.warning(t("voice.mismatchToast"), {
          duration: 5000,
        });
      }
    },
    (err) => {
      toast.error(err?.response?.data?.message || t("voice.compareFailed"));
    }
  );

  // ── Surface recorder errors (mic denied / hardware) ─────────────────────────
  useEffect(() => {
    if (recorder.error) toast.error(recorder.error);
  }, [recorder.error]);

  // ── Auto-compare each newly finished recording against the enrolled sample ──
  const lastComparedRef = useRef(null);
  useEffect(() => {
    const blob = recorder.audioBlob;
    if (blob && blob !== lastComparedRef.current) {
      lastComparedRef.current = blob;
      compare({ audioBlob: blob, enrollmentId, threshold: 0.6 });
    }
  }, [recorder.audioBlob, enrollmentId, compare]);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleToggleRecording = useCallback(() => {
    if (isRecording) {
      recorder.stopRecording();
    } else {
      resetCompare();
      recorder.startRecording();
    }
  }, [isRecording, recorder, resetCompare]);

  const handleRetake = useCallback(() => {
    lastComparedRef.current = null;
    resetCompare();
    recorder.retake();
  }, [recorder, resetCompare]);

  const handleNext = useCallback(() => {
    if (!recorder.audioBlob) {
      toast.error(t("voice.recordAnswer"));
      return;
    }
    onSubmit({ audio_blob: recorder.audioBlob });
  }, [recorder.audioBlob, onSubmit, t]);

  const questionText = question?.text || question?.question || "";

  return (
    <QuestionShell
      badgeText={t("voice.badge")}
      questionNumber={questionNumber || 1}
      questionText={questionText}
      onNext={handleNext}
      endTime={endTime}
      submitting={submitting}
      isLastQuestion={isLastQuestion}
    >
      <div className="mt-8 space-y-5">
        {/* Enrollment Status */}
        <div className="flex items-center gap-2">
          <EnrollmentBadge isEnrolling={isEnrolling} isEnrolled={isEnrolled} />
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-4">
          {!audioRecorded ? (
            <Button
              onClick={handleToggleRecording}
              disabled={isEnrolling}
              className={cn(
                "flex h-12 w-48 items-center gap-2 rounded-xl px-7 shadow-sm transition-colors",
                isRecording
                  ? "bg-red-100 text-red-600 hover:bg-red-200"
                  : "bg-[#a9c8ff] text-slate-900 hover:bg-[#97bcff]",
                isEnrolling && "opacity-60 cursor-not-allowed"
              )}
            >
              {isRecording ? (
                <Square className="h-4 w-4 fill-current" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
              {isRecording ? t("voice.stopRecording") : t("voice.startRecording")}
            </Button>
          ) : (
            <>
              <Button
                onClick={recorder.togglePlayback}
                disabled={isComparing}
                className="flex h-12 w-40 items-center justify-center gap-2 rounded-xl bg-green-500 px-7 text-white shadow-sm transition-colors hover:bg-green-600 disabled:opacity-60"
              >
                {recorder.isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
                {recorder.isPlaying ? t("voice.pause") : t("voice.listen")}
              </Button>
              <Button
                onClick={handleRetake}
                disabled={isComparing}
                className="flex h-12 w-40 items-center justify-center gap-2 rounded-xl bg-slate-100 px-7 text-slate-700 shadow-sm transition-colors hover:bg-slate-200 disabled:opacity-60"
              >
                <RotateCcw className="h-4 w-4" />
                {t("voice.reRecord")}
              </Button>
            </>
          )}
        </div>

        {/* Recording Status Banner */}
        <div
          className={cn(
            "flex items-center gap-3 rounded-xl px-5 py-4 transition-colors",
            audioRecorded
              ? "bg-green-50 text-green-700"
              : isRecording
              ? "bg-red-50 text-red-600"
              : "bg-[#eef4ff] text-[#5c7eb8]"
          )}
        >
          <div
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded text-white",
              audioRecorded ? "bg-green-500" : isRecording ? "bg-red-500" : "bg-[#7fa6eb]"
            )}
          >
            <AlertCircle className="h-4 w-4" />
          </div>
          <p className="text-[15px] font-medium">
            {audioRecorded
              ? t("voice.recordedStatus")
              : isRecording
              ? t("voice.recordingStatus")
              : t("voice.readyStatus")}
          </p>
        </div>

        {/* Voice Comparison Result */}
        <VoiceCompareResult isComparing={isComparing} result={compareResult} />

        {/* Recording Tips */}
        <div className="rounded-xl border border-blue-100 bg-[#f8fbff] p-5">
          <div className="mb-3 flex items-center gap-2 text-blue-600">
            <Lightbulb className="h-5 w-5 fill-blue-600" />
            <h4 className="font-semibold text-blue-900">{t("voice.tipsTitle")}</h4>
          </div>
          <ul className="space-y-2 ps-7 text-[14px] text-blue-500">
            <li className="relative before:absolute before:-start-4 before:top-2 before:h-1.5 before:w-1.5 before:rounded-full before:bg-blue-400">
              {t("voice.tip1")}
            </li>
            <li className="relative before:absolute before:-start-4 before:top-2 before:h-1.5 before:w-1.5 before:rounded-full before:bg-blue-400">
              {t("voice.tip2")}
            </li>
            <li className="relative before:absolute before:-start-4 before:top-2 before:h-1.5 before:w-1.5 before:rounded-full before:bg-blue-400">
              {t("voice.tip3")}
            </li>
          </ul>
        </div>
      </div>
    </QuestionShell>
  );
}
