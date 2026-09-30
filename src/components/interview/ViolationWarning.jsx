import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useTranslation } from "react-i18next";
import { MAX_VIOLATIONS } from "@/config/interview";
import { objectName, violationTitle } from "@/lib/violationCopy";
import { useFocusReturn } from "@hooks/useFocusReturn";

export default function ViolationWarning({
  isOpen = false,
  onClose,
  violationCount = 1,
  counts = true,
  titleKey,
  imagePath = "/multi-people.svg",
  descriptionKey,
  fixKey,
  label,
  labels,
  buttonText,
  finalWarning,
  identityCheck,
  alsoDetected = [],
}) {
  const { t, i18n } = useTranslation("interview");
  const focusReturn = useFocusReturn();
  const resolvedTitle = titleKey ? t(titleKey) : t("violationWarning.defaultTitle");
  // Naming the thing beats "prohibited device" — the candidate can only act on
  // the warning if they know what was seen.
  const object = objectName(t, { label, labels }, i18n.language);
  const resolvedDescription = descriptionKey
    ? t(descriptionKey, { object })
    : t("violationWarning.defaultDescription", { object });
  const resolvedButtonText = buttonText ?? t("violationWarning.defaultButtonText");

  // The strike before the last one says so outright — a candidate should never
  // be surprised by the termination that follows. Identity checks run to their
  // own limit, so that path sets the flag itself.
  const isFinalWarning = finalWarning ?? (counts && violationCount === MAX_VIOLATIONS - 1);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        role="alertdialog"
        showCloseButton={false}
        className="w-full rounded-2xl border-0 bg-[#f8f8f8] p-0 shadow-2xl overflow-hidden sm:max-w-[600px]"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        {...focusReturn}
      >
        <div className="relative px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <span>{t("violationWarning.rec")}</span>
              <span className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
            </div>

            {counts ? (
              <div className="rounded-lg border border-orange-200 bg-orange-50 px-2 py-1 text-sm font-semibold text-orange-500">
                {t("violationWarning.securityFlag", { violationCount, total: MAX_VIOLATIONS })}
              </div>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-sm font-semibold text-amber-600">
                {identityCheck
                  ? t("violationWarning.identityCheck", {
                      count: identityCheck.count,
                      total: identityCheck.limit,
                    })
                  : t("violationWarning.warning")}
              </div>
            )}
          </div>

          <div className="flex items-center justify-center mt-2">
            <div className="relative h-[250px] w-[350px]">
              <img src={imagePath} alt="" />
            </div>
          </div>

          {/* A new strike replaces the text while the dialog stays open. */}
          <div className="text-center" aria-live="assertive" aria-atomic="true">
            <DialogTitle className="text-lg leading-normal font-semibold">
              {resolvedTitle}
            </DialogTitle>

            <DialogDescription className="mx-auto mt-1.5 max-w-[480px] text-md leading-6 text-slate-500 font-medium">
              {resolvedDescription}
            </DialogDescription>

            {fixKey && (
              <p className="mx-auto mt-2 max-w-[480px] text-sm font-semibold leading-5 text-slate-700">
                {t(fixKey, { object })}
              </p>
            )}

            {alsoDetected.length > 0 && (
              <div className="mx-auto mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                  {t("violationWarning.alsoDetected")}
                </p>
                <ul className="mt-1 space-y-0.5 text-sm font-medium text-amber-800">
                  {alsoDetected.map((item) => (
                    <li key={violationTitle(t, item, i18n.language)}>
                      {violationTitle(t, item, i18n.language)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {isFinalWarning && (
              <p className="mx-auto mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-600">
                {t("violationWarning.finalWarning")}
              </p>
            )}
          </div>

          <div className="mt-5 flex justify-center">
            <Button
              type="button"
              onClick={onClose}
              className="h-12 rounded-xl bg-[#111827] px-8 text-sm font-semibold text-white hover:bg-black focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              {resolvedButtonText}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
