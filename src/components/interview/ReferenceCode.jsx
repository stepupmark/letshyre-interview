import { useTranslation } from "react-i18next";
import { useSupportInfo } from "@hooks/interview/useSupportInfo";

export function ReferenceCode({ sessionId, className = "" }) {
  const { t } = useTranslation("common");
  const { referenceCode } = useSupportInfo(sessionId);
  if (!referenceCode) return null;

  return (
    <div className={`text-center ${className}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {t("support.referenceCode.label")}
      </p>
      <p dir="ltr" className="mt-0.5 font-mono text-base font-bold tracking-wider text-slate-800">
        {referenceCode}
      </p>
      <p className="mt-0.5 text-xs text-slate-500">{t("support.referenceCode.hint")}</p>
    </div>
  );
}
