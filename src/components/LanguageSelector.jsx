import { Globe } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { LANGUAGES } from "@/i18n/languages";
import { cn } from "@/lib/utils";

/**
 * Interview language picker. Disabled once a session is in progress —
 * switching languages mid-interview would mix languages across questions.
 */
export default function LanguageSelector({ className }) {
  const { language, setLanguage, isLocked } = useLocale();

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-xl border border-[#c4d7f5] bg-white px-4 py-2.5 text-[15px] font-semibold text-[#5c85d6] shadow-sm",
        isLocked && "opacity-60",
        className,
      )}
    >
      <Globe className="h-[18px] w-[18px] shrink-0" />
      <select
        value={language}
        disabled={isLocked}
        onChange={(e) => setLanguage(e.target.value)}
        aria-label="Interview language"
        className="cursor-pointer bg-transparent outline-none disabled:cursor-not-allowed"
      >
        {LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.nativeLabel}
          </option>
        ))}
      </select>
    </div>
  );
}
