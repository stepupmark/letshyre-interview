import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { stopProctoringOnce } from "@/lib/electronRecording";

export function TerminatedUi() {
  const { t } = useTranslation("interview");
  // Stop only once the notice is visible, so it lands on the recording.
  useEffect(() => {
    stopProctoringOnce();
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-rose-100 mb-6">
        <AlertTriangle className="h-10 w-10 text-rose-600" />
      </div>
      <h2 className="mb-3 text-4xl font-extrabold tracking-tight text-slate-800">
        {t("terminated.heading")}
      </h2>
      <p className="max-w-lg text-[18px] leading-relaxed text-slate-600 font-medium">
        {t("terminated.description")}
      </p>
    </div>
  );
}
