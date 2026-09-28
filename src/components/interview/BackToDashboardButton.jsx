import { LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { hasActiveInterview, inDesktopApp, leaveToDashboard } from "@/lib/desktopExit";

/** Only inside the desktop app, and never over an interview that is still running. */
export function BackToDashboardButton({ reason, endSession = false, className = "" }) {
  const { t } = useTranslation("common");
  if (!inDesktopApp() || (!endSession && hasActiveInterview())) return null;

  return (
    <Button
      variant="outline"
      onClick={() => leaveToDashboard(reason, { endSession })}
      className={`h-12 rounded-2xl border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 ${className}`}
    >
      <LogOut className="me-2 h-4 w-4" />
      {t("desktopExit.backToDashboard")}
    </Button>
  );
}
