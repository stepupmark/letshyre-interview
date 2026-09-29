import { useEffect } from "react";
import { Ban, RefreshCcw, ServerCrash, AlertTriangle, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { BackToDashboardButton } from "@/components/interview/BackToDashboardButton";
import { ReferenceCode } from "@/components/interview/ReferenceCode";
import { releaseDesktop } from "@/lib/desktopExit";
import { START_FAILURE, isRetryableStartFailure, startFailureReason } from "@/lib/startFailure";

const ICONS = {
  [START_FAILURE.EXHAUSTED]: Ban,
  [START_FAILURE.REJECTED]: AlertTriangle,
  [START_FAILURE.NETWORK]: WifiOff,
  [START_FAILURE.SERVER]: ServerCrash,
};

export function InterviewStartFailed({ failure, onRetry }) {
  const { t } = useTranslation("common");
  const { kind, message } = failure;
  const retryable = isRetryableStartFailure(kind);
  const reason = startFailureReason(kind);
  const Icon = ICONS[kind] ?? AlertTriangle;

  // Trying again won't help, so the candidate isn't kept locked in meanwhile.
  useEffect(() => {
    if (!retryable) releaseDesktop(reason);
  }, [retryable, reason]);

  return (
    <div
      role="alert"
      className="flex min-h-screen flex-col items-center justify-center bg-[linear-gradient(180deg,#7fb0ff_0%,#cfe1ff_38%,#eef5ff_72%,#ffffff_100%)] px-4 text-center"
    >
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-[0_10px_40px_rgba(59,130,246,0.25)]">
        <Icon className="h-10 w-10 text-red-500" />
      </div>
      <h2 className="mb-3 text-3xl font-extrabold tracking-tight text-slate-800">
        {t(`startFailed.${kind}.title`)}
      </h2>
      <p className="max-w-md text-[16px] font-medium leading-relaxed text-slate-600">
        {t(`startFailed.${kind}.description`)}
      </p>
      {kind === START_FAILURE.REJECTED && message && (
        <p className="mt-3 max-w-md text-sm text-slate-500">{message}</p>
      )}

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        {retryable && (
          <Button
            onClick={onRetry}
            className="h-12 rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white shadow-lg transition-all hover:bg-slate-800"
          >
            <RefreshCcw className="me-2 h-4 w-4" />
            {t("startFailed.retry")}
          </Button>
        )}
        <BackToDashboardButton reason={reason} />
      </div>

      <ReferenceCode className="mt-8" />
    </div>
  );
}
