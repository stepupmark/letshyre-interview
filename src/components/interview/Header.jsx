import { Circle, Video, AlertTriangle, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MAX_VIOLATIONS } from "@/config/interview";
import LanguageSelector from "@/components/LanguageSelector";

export default function Header({ attempted, total, violations = 0 }) {
  const { t } = useTranslation("interview");

  // Determine badge styling based on violations count
  const badgeStyle =
    violations >= MAX_VIOLATIONS
      ? "border-rose-200 bg-rose-50 text-rose-700 animate-pulse"
      : violations > 0
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-emerald-200 bg-emerald-50/60 text-emerald-700";

  const BadgeIcon = violations > 0 ? AlertTriangle : ShieldCheck;

  return (
    <header className="sticky top-0 z-20 h-20 bg-white border-b px-8 shadow-sm">
      <div className="mx-auto flex h-full w-full items-center justify-between">
        <img src="/letshyre.png" alt="Logo" className="w-32" />
        <p className="text-xl font-semibold text-blue-500">
          {t("header.attempted", { attempted, total })}
        </p>
        <div className="flex gap-4">
          <LanguageSelector />

          {/* Violations / Compliance Badge */}
          <div className={`flex items-center gap-2 rounded-xl border px-5 py-2.5 text-[15px] font-bold shadow-sm transition-all duration-300 ${badgeStyle}`}>
            <BadgeIcon className={`h-[18px] w-[18px] ${violations > 0 ? "text-amber-500" : "text-emerald-500"}`} />
            <span>
              {violations > 0
                ? t("header.complianceFlags", { violations, max: MAX_VIOLATIONS })
                : t("header.complianceSecure")}
            </span>
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-[#c4d7f5] bg-white px-5 py-2.5 text-[15px] font-semibold text-[#5c85d6] shadow-sm">
            <Video className="h-[18px] w-[18px] fill-[#5c85d6]" />
            {t("header.monitoringActive")}
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-[#f5c6c6] bg-[#fff0f0] px-5 py-2.5 text-[15px] font-semibold text-[#ef4444] shadow-sm">
            <Circle className="h-3 w-3 fill-[#ef4444] text-[#ef4444]" />
            {t("header.recording")}
          </div>
        </div>
      </div>
    </header>
  );
}
