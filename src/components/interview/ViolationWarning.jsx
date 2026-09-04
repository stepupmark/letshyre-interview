import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useTranslation } from "react-i18next";
import { MAX_VIOLATIONS } from "@/config/interview";

export default function ViolationWarning({
  isOpen = false,
  onClose,
  violationCount = 1,
  counts = true,
  titleKey,
  imagePath = "/multi-people.png",
  descriptionKey,
  buttonText,
}) {
  const { t } = useTranslation("interview");
  const resolvedTitle = titleKey ? t(titleKey) : t("violationWarning.defaultTitle");
  const resolvedDescription = descriptionKey
    ? t(descriptionKey)
    : t("violationWarning.defaultDescription");
  const resolvedButtonText = buttonText ?? t("violationWarning.defaultButtonText");

  // The strike before the last one says so outright — a candidate should never
  // be surprised by the termination that follows.
  const isFinalWarning = counts && violationCount === MAX_VIOLATIONS - 1;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        showCloseButton={false}
        className="w-[420px] rounded-lg border-0 bg-[#f8f8f8] p-0 shadow-2xl overflow-hidden"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div className="relative p-5">
          {/* Top Row */}
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
                {t("violationWarning.warning")}
              </div>
            )}
          </div>

          <div className="flex items-center justify-center mt-2">
            <div className="relative h-[250px] w-[350px]">
              <img src={imagePath} alt="" />
            </div>
          </div>

          {/* Content */}
          <div className="text-center">
            <h2 className="text-lg font-semibold">{resolvedTitle}</h2>

            <p className="mx-auto mt-1.5 text-md leading-6 text-slate-500 font-medium">
              {resolvedDescription}
            </p>

            {isFinalWarning && (
              <p className="mx-auto mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-600">
                {t("violationWarning.finalWarning")}
              </p>
            )}
          </div>

          {/* Button */}
          <div className="mt-4 flex justify-center">
            <Button
              type="button"
              onClick={onClose}
              className="h-12 rounded-xl bg-[#111827] px-8 text-sm font-semibold text-white hover:bg-black"
            >
              {resolvedButtonText}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
