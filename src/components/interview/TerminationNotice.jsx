import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getTerminationCopy } from "@/lib/terminationReasons";
import {
  FACE_MISMATCH_LIMIT,
  MAX_INTERNET_DISCONNECTS,
  MAX_VIOLATIONS,
} from "@/config/interview";

export default function TerminationNotice({ reason, secondsLeft, onAcknowledge }) {
  const { t } = useTranslation("interview");
  const { titleKey, descriptionKey, pillKey, imagePath, punitive } = getTerminationCopy(reason);

  // Every limit is passed to each string; i18next ignores the ones a given
  // message doesn't interpolate.
  const counts = {
    violations: MAX_VIOLATIONS,
    faceMismatches: FACE_MISMATCH_LIMIT,
    disconnects: MAX_INTERNET_DISCONNECTS,
  };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="termination-title"
      aria-describedby="termination-description"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 select-none backdrop-blur-sm"
    >
      <div className="w-full max-w-[440px] overflow-hidden rounded-2xl bg-[#f8f8f8] shadow-2xl">
        <div className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <span>{t("violationWarning.rec")}</span>
              <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
            </div>

            <div
              className={
                punitive
                  ? "rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-sm font-semibold text-red-600"
                  : "rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-sm font-semibold text-slate-600"
              }
            >
              {t(pillKey, counts)}
            </div>
          </div>

          <div className="mt-2 flex items-center justify-center">
            <div className="relative h-[220px] w-[330px]">
              <img src={imagePath} alt="" />
            </div>
          </div>

          <div className="text-center">
            <div className="mb-2 flex justify-center">
              <span
                className={
                  punitive
                    ? "flex h-11 w-11 items-center justify-center rounded-full bg-red-50"
                    : "flex h-11 w-11 items-center justify-center rounded-full bg-blue-50"
                }
              >
                <ShieldAlert
                  className={punitive ? "h-6 w-6 text-red-500" : "h-6 w-6 text-blue-500"}
                />
              </span>
            </div>

            <h2 id="termination-title" className="text-lg font-semibold text-slate-800">
              {t(titleKey, counts)}
            </h2>

            <p
              id="termination-description"
              className="text-md mx-auto mt-1.5 font-medium leading-6 text-slate-500"
            >
              {t(descriptionKey, counts)}
            </p>
          </div>

          <div className="mt-5 flex flex-col items-center gap-2">
            <Button
              type="button"
              onClick={onAcknowledge}
              className="h-12 rounded-xl bg-[#111827] px-8 text-sm font-semibold text-white hover:bg-black"
            >
              {t("termination.acknowledge")}
            </Button>
            <p className="text-xs font-medium text-slate-400">
              {t("termination.countdown", { count: secondsLeft })}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
