import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatClock } from "@/lib/utils";
import { objectName, violationTitle } from "@/lib/violationCopy";
import { useNow } from "@hooks/useNow";

// Stays up while something is still in view after its strike, without pulling
// the candidate out of their answer the way the warning dialog does.
export default function HeldViolationBanner({ items = [] }) {
  const { t, i18n } = useTranslation("interview");
  const counting = items.some((item) => item.nextStrikeAt);
  const now = useNow(counting);
  if (!items.length) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
          {t("violationWarning.stillDetected")}
        </p>
        {items.map((item) => (
          <div key={item.key}>
            <p className="text-sm text-amber-900">
              <span className="font-semibold">{violationTitle(t, item, i18n.language)}</span>{" "}
              {t(item.descriptionKey, { object: objectName(t, item, i18n.language) })}
            </p>
            {item.nextStrikeAt ? (
              <p className="text-sm font-semibold text-red-700">
                {/* The ticking time stays out of the live region so it isn't read every second. */}
                <span aria-hidden="true">
                  {item.nextStrikeAt > now
                    ? t("inInterview.held.restrikeIn", {
                        time: formatClock(item.nextStrikeAt - now),
                      })
                    : t("inInterview.held.restrikeNow")}
                </span>
                <span className="sr-only">{t("inInterview.held.restrikePending")}</span>
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
