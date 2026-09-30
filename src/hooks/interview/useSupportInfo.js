import { useEffect, useMemo, useState } from "react";
import { logger } from "@/lib/logger";

const clean = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);

/** Support contact from the desktop app; null in older apps and plain browsers. */
export function useSupportInfo() {
  const [appInfo, setAppInfo] = useState(null);

  useEffect(() => {
    const getSupportContact = window.electronAPI?.getSupportContact;
    if (typeof getSupportContact !== "function") return;
    let cancelled = false;
    Promise.resolve()
      .then(() => getSupportContact())
      .then(
        (info) => {
          if (!cancelled && info && typeof info === "object") setAppInfo(info);
        },
        (err) => logger.warn("[Support] getSupportContact failed:", err?.message),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => {
    const url = clean(appInfo?.url);
    const email = clean(appInfo?.email);
    return { contact: url || email ? { url, email } : null };
  }, [appInfo]);
}
