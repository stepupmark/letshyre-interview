import { WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MAX_INTERNET_DISCONNECTS } from "@/config/interview";
import { useOnlineStatus } from "@hooks/interview/useOnlineStatus";

// The status region stays mounted so screen readers announce it the moment it fills.
export default function OfflineBanner({ disconnects = 0 }) {
  const { t } = useTranslation("interview");
  const online = useOnlineStatus();

  return (
    <div role="status" aria-live="polite">
      {!online && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
          <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
          <p className="text-sm font-medium text-red-800">
            {t("inInterview.offline.message", {
              disconnects,
              max: MAX_INTERNET_DISCONNECTS,
            })}
          </p>
        </div>
      )}
    </div>
  );
}
