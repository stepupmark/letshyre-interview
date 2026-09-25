import { useEffect } from "react";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";

export function DesktopUpdateRequired() {
  const { t } = useTranslation("interview");

  // Nothing started, so the app can let the candidate close it and update.
  useEffect(() => {
    window.electronAPI?.interviewComplete?.("update-required");
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-blue-100">
        <Download className="h-10 w-10 text-blue-600" />
      </div>
      <h2 className="mb-3 text-4xl font-extrabold tracking-tight text-slate-800">
        {t("desktopUpdate.heading")}
      </h2>
      <p className="max-w-lg text-[18px] font-medium leading-relaxed text-slate-600">
        {t("desktopUpdate.description")}
      </p>
    </div>
  );
}
