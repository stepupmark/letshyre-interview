import { Maximize2 } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function FullscreenPrompt({ onRestore }) {
  const { t } = useTranslation("interview");

  return (
    <div className="flex w-[var(--width)] items-start gap-3.5 rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_10px_30px_-12px_rgb(15_23_42/0.25)]">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 ring-1 ring-amber-100">
        <Maximize2 className="size-4" strokeWidth={2.25} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold tracking-[-0.01em] text-slate-900">
          {t("violations.fullscreenRestore.title")}
        </p>
        <p className="mt-0.5 text-[13px] leading-5 text-slate-500">
          {t("violations.fullscreenRestore.description")}
        </p>

        <button
          type="button"
          onClick={onRestore}
          className="mt-3 w-full rounded-lg bg-slate-900 px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {t("violations.fullscreenRestore.action")}
        </button>
      </div>
    </div>
  );
}
