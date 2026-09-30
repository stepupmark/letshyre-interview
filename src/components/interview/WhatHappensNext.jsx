import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";

const ITEMS = {
  completed: ["review", "contact"],
  ended: ["submitted", "review"],
};

/** `variant` is "completed" for an interview that ran its course, "ended" for one cut short. */
export function WhatHappensNext({ variant = "completed", className = "" }) {
  const { t } = useTranslation("common");

  return (
    <section className={`text-start ${className}`} aria-labelledby="what-next-title">
      <h3 id="what-next-title" className="text-sm font-bold text-slate-800">
        {t("support.whatNext.title")}
      </h3>
      <ul className="mt-2 space-y-1.5">
        {ITEMS[variant].map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm leading-snug text-slate-600">
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-blue-400 rtl:rotate-180" />
            <span>{t(`support.whatNext.${variant}.${item}`)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
