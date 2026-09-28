import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useCountdown } from "@hooks/interview/useCountdown";

function format(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(total / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

// Ticks on its own so the 1s re-render stays here instead of re-rendering the
// whole question every second.
export default function CountdownTimer({ endTime }) {
  const { t } = useTranslation("interview");
  const { remainingMs, level, urgent, announcement } = useCountdown(endTime);

  return (
    <>
      <div
        role="timer"
        aria-label={t("inInterview.timer.label")}
        data-level={urgent ? "urgent" : level ? "warning" : "normal"}
        className={cn(
          "rounded-xl px-5 py-2 font-mono text-2xl shadow-lg transition-colors",
          urgent
            ? "bg-red-600 text-white"
            : level
              ? "bg-amber-400 text-black"
              : "bg-black text-white",
        )}
      >
        {format(remainingMs)}
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {announcement ? t("inInterview.timer.warning", { minutes: announcement }) : ""}
      </span>
    </>
  );
}
