import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCameraCheck } from "@hooks/interview/useCameraCheck";
import CandidateCameraCard from "./CandidateCameraCard";

const CHECKS = ["oneFace", "centred", "bright"];

export function PreStartCameraCheck({ onFinish }) {
  const { t } = useTranslation("interview");
  const videoRef = useRef(null);
  const check = useCameraCheck(videoRef);

  return (
    <div className="w-full max-w-2xl rounded-3xl bg-white p-8 text-start shadow-xl">
      <h2 id="pre-start-title" className="text-2xl font-extrabold text-slate-800">
        {t("preStart.camera.title")}
      </h2>
      <p className="mt-2 text-slate-600">{t("preStart.camera.description")}</p>

      <div className="mt-6 grid items-start gap-6 sm:grid-cols-[3fr_2fr]">
        <CandidateCameraCard videoRef={videoRef} onStatusChange={check.onCameraStatus} />

        <div aria-live="polite">
          {check.status === "starting" && (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("preStart.camera.starting")}
            </p>
          )}

          {check.status !== "unavailable" && check.status !== "starting" && (
            <ul className="space-y-2">
              {CHECKS.map((name) => {
                const ok = check.status === "passed" || check.checks?.[name];
                return (
                  <li
                    key={name}
                    data-check={name}
                    data-ok={ok ? "true" : "false"}
                    className={`flex items-center gap-2 text-sm ${ok ? "text-emerald-700" : "text-slate-600"}`}
                  >
                    {ok ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                    ) : (
                      <Circle className="h-4 w-4 shrink-0 text-slate-300" />
                    )}
                    {t(`preStart.camera.checks.${name}`)}
                  </li>
                );
              })}
            </ul>
          )}

          {check.status === "checking" && (
            <p className="mt-3 text-xs font-medium text-slate-400">
              {t("preStart.camera.attempt", { attempt: check.attempt, max: check.maxAttempts })}
            </p>
          )}
          {check.status === "passed" && (
            <p className="mt-3 text-sm font-semibold text-emerald-700">
              {t("preStart.camera.passed")}
            </p>
          )}
          {check.status === "unavailable" && (
            <p className="text-sm text-slate-600">{t("preStart.camera.unavailable")}</p>
          )}
          {check.canSkip && check.status !== "unavailable" && (
            <p className="mt-3 text-sm text-amber-700">{t("preStart.camera.skipHint")}</p>
          )}
        </div>
      </div>

      <div className="mt-8 flex justify-end">
        <Button
          onClick={() => onFinish(check.outcome)}
          disabled={!check.canContinue && !check.canSkip}
          className="h-12 rounded-xl bg-slate-900 px-8 text-sm font-semibold text-white hover:bg-black"
        >
          {check.canContinue ? t("preStart.camera.start") : t("preStart.camera.continueAnyway")}
        </Button>
      </div>
    </div>
  );
}
