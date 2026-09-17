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
import { useVoiceEnrollment } from "@mutations/useVoiceEnrollment";
import { useVoiceCompare } from "@mutations/useVoiceCompare";
import { recordViolationEvent } from "@/lib/violationLog";

const VOICE_MATCH_THRESHOLD = 0.6;
const WARNING_CODES = new Set(["micSwitched"]);

function VoiceCompareResult({ isComparing, result }) {
  const { t } = useTranslation("questions");

  if (isComparing) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 px-5 py-4 animate-in fade-in duration-300">
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-blue-500" />
        <p className="text-[14px] font-semibold text-blue-700">{t("voice.verifying")}</p>
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
        isMatch ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50",
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
        <p className={cn("text-[14px] font-bold", isMatch ? "text-emerald-800" : "text-amber-800")}>
          {isMatch ? t("voice.verified") : t("voice.mismatchDetected")}
        </p>
        <p
          className={cn("text-[13px] font-medium", isMatch ? "text-emerald-600" : "text-amber-600")}
        >
          {isMatch ? t("voice.matchResult", { score }) : t("voice.mismatchResult", { score })}
        </p>
      </div>
    </div>
  );
}

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

function LevelMeter({ level }) {
  const { t } = useTranslation("questions");
  // Speech rarely peaks past a third of full scale, so stretch it to fill the bar.
  const percent = Math.round(Math.min(1, level * 3) * 100);

  return (
    <div
      role="meter"
      aria-label={t("voice.inputLevel")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-red-100"
    >
      <div
        className="h-full rounded-full bg-red-500 transition-[width] duration-100"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export default function VoiceQuestion({
  question,
  onSubmit,
  questionNumber,
  endTime,
  submitting,
  isLastQuestion,
}) {
  const { t } = useTranslation("questions");
  const recorder = useAudioRecorder();
  const isStarting = recorder.status === "starting";
  const isRecording = recorder.status === "recording";
  const isCapturing = isStarting || isRecording;
  const audioRecorded = recorder.status === "reviewing" && !!recorder.audioBlob;

  const { enroll, isEnrolling, isEnrolled, enrollmentId } = useVoiceEnrollment();

  useEffect(() => {
    if (!isEnrolled && !isEnrolling) {
      enroll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    compare,
    isComparing,
    compareResult,
    reset: resetCompare,
  } = useVoiceCompare(
    (data) => {
      // Logged for reviewers only; the threshold is too loose to strike on.
      recordViolationEvent({
        source: "voice",
        type: "VOICE_MISMATCH",
        outcome: data?.data?.matched ? "matched" : "mismatch",
        score: data?.data?.score ?? null,
        question_number: questionNumber ?? null,
      });
      if (!data?.data?.matched) {
        toast.warning(t("voice.mismatchToast"), {
          duration: 5000,
        });
      }
    },
    (err) => {
      toast.error(err?.response?.data?.message || t("voice.compareFailed"));
    },
  );

  useEffect(() => {
    if (!recorder.error) return;
    const { code } = recorder.error;
    const notify = WARNING_CODES.has(code) ? toast.warning : toast.error;
    notify(t(`voice.errors.${code}`));
  }, [recorder.error, t]);

  const lastComparedRef = useRef(null);
  useEffect(() => {
    const blob = recorder.audioBlob;
    if (blob && blob !== lastComparedRef.current) {
      lastComparedRef.current = blob;
      compare({ audioBlob: blob, enrollmentId, threshold: VOICE_MATCH_THRESHOLD });
    }
  }, [recorder.audioBlob, enrollmentId, compare]);

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
        <div className="flex items-center gap-2">
          <EnrollmentBadge isEnrolling={isEnrolling} isEnrolled={isEnrolled} />
        </div>

        {recorder.devices.length > 1 && !audioRecorded && (
          <label className="flex flex-wrap items-center gap-3 text-[14px] font-medium text-slate-700">
            <span className="flex items-center gap-1.5">
              <Mic className="h-4 w-4" />
              {t("voice.microphone")}
            </span>
            <select
              value={recorder.deviceId}
              onChange={(e) => recorder.selectDevice(e.target.value)}
              disabled={isCapturing}
              className="h-10 max-w-full min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-[14px] text-slate-800 disabled:opacity-60 sm:max-w-sm"
            >
              {recorder.devices.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || t("voice.microphoneFallback", { number: index + 1 })}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex flex-wrap items-center gap-4">
          {!audioRecorded ? (
            <Button
              onClick={handleToggleRecording}
              disabled={isEnrolling || isStarting}
              className={cn(
                "flex h-12 w-48 items-center gap-2 rounded-xl px-7 shadow-sm transition-colors",
                isCapturing
                  ? "bg-red-100 text-red-600 hover:bg-red-200"
                  : "bg-[#a9c8ff] text-slate-900 hover:bg-[#97bcff]",
                (isEnrolling || isStarting) && "opacity-60 cursor-not-allowed",
              )}
            >
              {isStarting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isRecording ? (
                <Square className="h-4 w-4 fill-current" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
              {isCapturing ? t("voice.stopRecording") : t("voice.startRecording")}
            </Button>
          ) : (
            <>
              <Button
                onClick={recorder.togglePlayback}
                disabled={isComparing}
                className="flex h-12 w-40 items-center justify-center gap-2 rounded-xl bg-green-500 px-7 text-white shadow-sm transition-colors hover:bg-green-600 disabled:opacity-60"
              >
                {recorder.isPlaying ? (
                  <Pause className="h-4 w-4 fill-current" />
                ) : (
                  <Play className="h-4 w-4 fill-current" />
                )}
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

        <div
          className={cn(
            "flex items-center gap-3 rounded-xl px-5 py-4 transition-colors",
            audioRecorded
              ? "bg-green-50 text-green-700"
              : isCapturing
                ? "bg-red-50 text-red-600"
                : "bg-[#eef4ff] text-[#5c7eb8]",
          )}
        >
          <div
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded text-white",
              audioRecorded ? "bg-green-500" : isCapturing ? "bg-red-500" : "bg-[#7fa6eb]",
            )}
          >
            <AlertCircle className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-medium">
              {audioRecorded
                ? t("voice.recordedStatus")
                : isStarting
                  ? t("voice.preparing")
                  : isRecording
                    ? recorder.inputMuted
                      ? t("voice.micMuted")
                      : t("voice.recordingStatus")
                    : t("voice.readyStatus")}
            </p>
            {isCapturing && <LevelMeter level={recorder.level} />}
          </div>
        </div>

        <VoiceCompareResult isComparing={isComparing} result={compareResult} />

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
