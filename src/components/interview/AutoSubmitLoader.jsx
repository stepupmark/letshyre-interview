import { useEffect, useState } from "react";
import { AlertCircle, RotateCw, Check, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getTerminationCopy, isTerminationReason } from "@/lib/terminationReasons";

export default function AutoSubmitLoader({ reason, isSuccess = false, error = null, onRetry }) {
  const { t } = useTranslation("interview");
  const [progress, setProgress] = useState(0);
  const [retrying, setRetrying] = useState(false);

  const [prevError, setPrevError] = useState(error);
  if (error !== prevError) {
    setPrevError(error);
    if (!error) setRetrying(false);
  }

  // Track real connectivity so a server-side failure isn't mislabeled "offline".
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== "undefined" && navigator.onLine === false,
  );

  useEffect(() => {
    const goOnline = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    if (error || isSuccess) return;

    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 99) {
          clearInterval(timer);
          return 99;
        }

        let increment;
        if (prev < 25) increment = 2.5;
        else if (prev < 55) increment = 1.8;
        else if (prev < 80) increment = 1.0;
        else increment = 0.3;

        return Math.min(99, +(prev + increment).toFixed(0));
      });
    }, 150);

    return () => clearInterval(timer);
  }, [isSuccess, error]);

  const radius = 68;
  const stroke = 5;
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const displayProgress = isSuccess ? 100 : progress;
  const strokeDashoffset = circumference - (displayProgress / 100) * circumference;

  const formatReason = (rawReason) => {
    if (!rawReason) return t("autoSubmitLoader.reasonAutoSubmitted");
    if (!isTerminationReason(rawReason)) return rawReason;
    return t(getTerminationCopy(rawReason).pillKey);
  };

  const gradientId = error
    ? "error-gradient"
    : isSuccess
      ? "success-gradient"
      : "progress-gradient";

  const handleRetry = () => {
    setRetrying(true);
    onRetry?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[linear-gradient(180deg,#7fb0ff_0%,#cfe1ff_38%,#eef5ff_72%,#ffffff_100%)] p-4 text-center select-none">
      <div className="w-full max-w-[500px]">
        {/* Card */}
        <div className="rounded-3xl bg-white border border-slate-200/80 p-8 shadow-lg shadow-blue-900/5">
          {/* Logo */}
          <div className="flex justify-center mb-6">
            <img src="/letshyre.png" alt="Let's Hyre" className="w-28 opacity-80" />
          </div>

          {/* Progress ring */}
          <div
            className="relative mx-auto flex items-center justify-center mb-6"
            style={{ width: radius * 2, height: radius * 2 }}
          >
            <svg height={radius * 2} width={radius * 2} className="-rotate-90">
              <circle
                stroke={error ? "#fde8e8" : "#f1f5f9"}
                fill="transparent"
                strokeWidth={stroke}
                r={normalizedRadius}
                cx={radius}
                cy={radius}
              />
              <circle
                stroke={`url(#${gradientId})`}
                fill="transparent"
                strokeWidth={stroke}
                strokeDasharray={circumference + " " + circumference}
                style={{
                  strokeDashoffset,
                  transition: "stroke-dashoffset 0.35s ease-out",
                }}
                strokeLinecap="round"
                r={normalizedRadius}
                cx={radius}
                cy={radius}
              />
              <defs>
                <linearGradient id="progress-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#3b82f6" />
                  <stop offset="100%" stopColor="#6366f1" />
                </linearGradient>
                <linearGradient id="success-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="100%" stopColor="#059669" />
                </linearGradient>
                <linearGradient id="error-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ef4444" />
                  <stop offset="100%" stopColor="#f97316" />
                </linearGradient>
              </defs>
            </svg>

            <div className="absolute flex flex-col items-center justify-center">
              {error ? (
                isOffline ? (
                  <WifiOff className="h-9 w-9 text-rose-400" />
                ) : (
                  <AlertCircle className="h-9 w-9 text-rose-400" />
                )
              ) : isSuccess ? (
                <div className="flex items-center justify-center h-12 w-12 rounded-full bg-emerald-50 border border-emerald-200">
                  <Check className="h-6 w-6 text-emerald-600" />
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <div className="flex items-baseline">
                    <span className="text-[38px] font-extrabold tracking-tight text-slate-800 tabular-nums leading-none">
                      {progress}
                    </span>
                    <span className="text-sm font-bold text-blue-500 ms-0.5">%</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Title */}
          <h2
            className={`mb-1.5 text-xl font-bold ${
              error ? "text-slate-800" : isSuccess ? "text-slate-800" : "text-slate-800"
            }`}
          >
            {error
              ? isOffline
                ? t("autoSubmitLoader.noInternet")
                : t("autoSubmitLoader.submissionFailed")
              : isSuccess
                ? t("autoSubmitLoader.interviewSubmitted")
                : t("autoSubmitLoader.submittingInterview")}
          </h2>

          {/* Reason pill */}
          <div
            className={`mx-auto mb-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
              error
                ? "bg-rose-50 text-rose-600 border border-rose-100"
                : isSuccess
                  ? "bg-emerald-50 text-emerald-600 border border-emerald-100"
                  : "bg-blue-50 text-blue-600 border border-blue-100"
            }`}
          >
            {error ? (
              <>
                <AlertCircle className="h-3 w-3" />
                <span>
                  {isOffline
                    ? t("autoSubmitLoader.waitingForConnection")
                    : t("autoSubmitLoader.actionNeeded")}
                </span>
              </>
            ) : isSuccess ? (
              <>
                <Check className="h-3 w-3" />
                <span>{t("autoSubmitLoader.done")}</span>
              </>
            ) : (
              <>
                <span>{t("autoSubmitLoader.reason", { reason: formatReason(reason) })}</span>
              </>
            )}
          </div>

          {/* Message */}
          <p className="mb-6 text-sm text-slate-500 leading-relaxed max-w-xs mx-auto">
            {error
              ? isOffline
                ? t("autoSubmitLoader.messageOffline")
                : t("autoSubmitLoader.messageError", {
                    errorText:
                      typeof error === "string"
                        ? error
                        : t("autoSubmitLoader.messageErrorGenericFallback"),
                  })
              : isSuccess
                ? t("autoSubmitLoader.messageSuccess")
                : t("autoSubmitLoader.messageSubmitting")}
          </p>

          {/* Retry button */}
          {error && (
            <div className="mb-6 flex justify-center">
              <button
                onClick={handleRetry}
                disabled={retrying}
                className="flex items-center gap-2 rounded-xl bg-slate-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-900 active:scale-[0.97] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RotateCw className={`h-4 w-4 ${retrying ? "animate-spin" : ""}`} />
                {retrying ? t("autoSubmitLoader.retrying") : t("autoSubmitLoader.tryAgain")}
              </button>
            </div>
          )}

        </div>

        {/* Waiting text below card */}
        <p className="mt-6 text-sm font-medium text-blue-800/50">
          {error
            ? isOffline
              ? t("autoSubmitLoader.waitingOffline")
              : t("autoSubmitLoader.waitingError")
            : isSuccess
              ? t("autoSubmitLoader.waitingSuccess")
              : t("autoSubmitLoader.waitingSubmitting")}
        </p>
      </div>
    </div>
  );
}

