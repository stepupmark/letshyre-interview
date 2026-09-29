import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { TIME_WARNING_MINUTES } from "@/config/interview";

const WARNED_KEY = "interview_time_warned";
const THRESHOLDS = [...TIME_WARNING_MINUTES].sort((a, b) => b - a);

// Keyed by end time so a reload, or the timer remounting with each question,
// never warns twice for the same interview.
function readWarned(endTime) {
  try {
    const stored = JSON.parse(sessionStorage.getItem(`${WARNED_KEY}:${endTime}`));
    return new Set(Array.isArray(stored) ? stored : []);
  } catch {
    return new Set();
  }
}

function writeWarned(endTime, warned) {
  try {
    sessionStorage.setItem(`${WARNED_KEY}:${endTime}`, JSON.stringify([...warned]));
  } catch {
    // storage blocked: this page still remembers
  }
}

// How many thresholds are behind us: 0 until the first, THRESHOLDS.length at the last.
function levelFor(remainingMs) {
  if (remainingMs <= 0) return 0;
  return THRESHOLDS.filter((minutes) => remainingMs <= minutes * 60_000).length;
}

/**
 * Ticks toward an absolute `endTime` and warns once per threshold in
 * TIME_WARNING_MINUTES. `level` counts the thresholds passed, `urgent` is true
 * past the last one, and `announcement` is the minutes of the warning just given.
 */
export function useCountdown(endTime) {
  const { t } = useTranslation("interview");
  const [remainingMs, setRemainingMs] = useState(() =>
    endTime ? Math.max(0, endTime - Date.now()) : 0,
  );
  const [announcement, setAnnouncement] = useState(null);

  useEffect(() => {
    if (!endTime) return;
    let stopped = false;

    const tick = () => {
      if (stopped) return 0;
      const remaining = Math.max(0, endTime - Date.now());
      setRemainingMs(remaining);
      const level = levelFor(remaining);
      if (!level) return remaining;
      const minutes = THRESHOLDS[level - 1];
      const warned = readWarned(endTime);
      if (warned.has(minutes)) return remaining;
      for (const passed of THRESHOLDS.slice(0, level)) warned.add(passed);
      writeWarned(endTime, warned);
      setAnnouncement(minutes);
      toast.warning(t("inInterview.timer.warning", { minutes }), {
        id: "time-warning",
        description: t("inInterview.timer.warningHint"),
      });
      return remaining;
    };

    queueMicrotask(tick);
    const id = setInterval(() => {
      if (tick() <= 0) clearInterval(id);
    }, 1000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [endTime, t]);

  const level = levelFor(remainingMs);
  return {
    remainingMs,
    level,
    urgent: level === THRESHOLDS.length,
    announcement,
  };
}
