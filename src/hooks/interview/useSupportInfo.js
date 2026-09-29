import { useEffect, useMemo, useState } from "react";
import { logger } from "@/lib/logger";
import { referenceCode } from "@/lib/referenceCode";

const clean = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);

/**
 * Support contact from the desktop app, and the candidate's reference code.
 * Older apps and plain browsers have no contact to give, so `contact` is null
 * there. The code comes from the session when there is one, which is what the
 * app derives too; before a session exists only the app can supply it.
 */
export function useSupportInfo(sessionId) {
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
    return {
      contact: url || email ? { url, email } : null,
      referenceCode: referenceCode(sessionId) ?? clean(appInfo?.referenceCode),
    };
  }, [appInfo, sessionId]);
}
