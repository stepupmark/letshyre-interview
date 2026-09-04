import { useTranslation } from "react-i18next";
import { Button } from "../ui/button";
import { INTERVIEW_SESSION_STORAGE_KEY } from "@/config/interview";

const isElectron =
  typeof window !== "undefined" && typeof window.electronAPI?.viewDashboard === "function";

export default function PostInterviewHeader() {
  const { t } = useTranslation("common");

  // Leaving the scorecard ends the interview — drop the finished session so the
  // next attempt starts fresh instead of restoring this scorecard.
  const handleViewDashboard = () => {
    sessionStorage.removeItem(INTERVIEW_SESSION_STORAGE_KEY);
    window.electronAPI.viewDashboard();
  };

  return (
    <header className="sticky top-0 z-20 h-20 bg-white border-b px-8 shadow-sm">
      <div className="mx-auto flex h-full w-full items-center justify-between">
        <img src="/letshyre.png" alt="Logo" className="w-32" />
        {isElectron && (
          <Button
            variant="default"
            size="sm"
            className="flex items-center gap-2 font-medium shadow-sm transition-all hover:shadow-md bg-blue-500 p-2.5"
            onClick={handleViewDashboard}
          >
            {t("postInterviewHeader.viewDashboard")}
          </Button>
        )}
      </div>
    </header>
  );
}
