import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import CandidateCameraCard from "./CandidateCameraCard";

export default function LeftPanel({ videoRef, onCameraStatus }) {
  const { t } = useTranslation("common");

  return (
    <div className="flex h-full flex-col gap-6">
      {/* CAMERA SECTION */}
      <div className="shrink-0">
        <CandidateCameraCard videoRef={videoRef} onStatusChange={onCameraStatus} />
      </div>

      {/* AI INTERVIEWER */}
      <div className="flex flex-1 flex-col items-center justify-center p-4 backdrop-blur-sm">
        <div className="flex max-h-[420px]  flex-1 items-center justify-center">
          <img
            src="/robo.png"
            alt={t("leftPanel.aiInterviewerAlt")}
            className="h-full max-h-[360px] w-auto object-contain"
          />
        </div>

        <div className="mt-4 flex items-center gap-2 text-sm font-semibold text-blue-700">
          <Sparkles className="h-4 w-4" />
          <span>{t("leftPanel.aiInterviewerActive")}</span>
        </div>
      </div>
    </div>
  );
}
