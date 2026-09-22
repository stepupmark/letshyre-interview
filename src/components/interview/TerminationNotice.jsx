import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getTerminationCopy, TERMINATION_REASONS } from "@/lib/terminationReasons";
import { violationTitle } from "@/lib/violationCopy";
import { MAX_INTERNET_DISCONNECTS, MAX_VIOLATIONS } from "@/config/interview";

// These titles are generic, so the list names what was actually seen.
export default function TerminationNotice({
  reason,
  secondsLeft,
  onAcknowledge,
  strikes = [],
  securityBlock,
}) {
  const { t, i18n } = useTranslation("interview");
  const { titleKey, descriptionKey, pillKey, imagePath, punitive } = getTerminationCopy(reason);

  const detected =
    reason === TERMINATION_REASONS.ELECTRON_SECURITY &&
    securityBlock &&
    securityBlock.type !== "ELECTRON_GENERIC"
      ? securityBlock
      : null;
  const summary = reason === TERMINATION_REASONS.VIOLATION_LIMIT ? strikes : [];
  const final = summary.at(-1);
  const strikeTitle = (strike) => violationTitle(t, strike, i18n.language);

  // i18next ignores the counts a given message doesn't interpolate.
  const counts = {
    violations: MAX_VIOLATIONS,
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
            <div className={final ? "h-[150px] w-[260px]" : "h-[220px] w-[330px]"}>
              <img
                src={final?.imagePath || imagePath}
                alt=""
                className="h-full w-full object-contain"
              />
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

          {detected && (
            <div className="mt-4 rounded-xl border border-red-100 bg-red-50/70 px-4 py-3 text-start">
              <p className="text-xs font-semibold text-red-500">
                {t("termination.electronSecurity.detected")}
              </p>
              <p className="mt-0.5 text-sm font-semibold text-slate-800">{t(detected.titleKey)}</p>
            </div>
          )}

          {final && (
            <div className="mt-4 space-y-3 text-start">
              <div className="rounded-xl border border-red-100 bg-red-50/70 px-4 py-3">
                <p className="text-xs font-semibold text-red-500">
                  {t("termination.violationLimit.finalReason", {
                    count: final.count,
                    total: MAX_VIOLATIONS,
                  })}
                </p>
                <p className="mt-0.5 text-sm font-semibold text-slate-800">{strikeTitle(final)}</p>
              </div>

              {summary.length > 1 && (
                <div className="px-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {t("termination.violationLimit.allViolations")}
                  </p>
                  <ol className="mt-1.5 space-y-1 text-sm text-slate-600">
                    {summary.map((strike) => (
                      <li
                        key={`${strike.count}-${strike.at}`}
                        className={strike === final ? "font-semibold text-red-600" : undefined}
                      >
                        {strike.count}. {strikeTitle(strike)}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}

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
