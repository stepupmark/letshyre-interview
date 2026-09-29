import { useEffect, useRef } from "react";
import { logger } from "@/lib/logger";
import { openRealCamera, VIRTUAL_ONLY } from "@/lib/cameraSource";

export default function CandidateCameraCard({ videoRef, onStatusChange }) {
  const streamRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      try {
        const stream = await openRealCamera();

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current
              .play()
              .then(() => {
                onStatusChange?.("ok");
              })
              .catch((err) => {
                logger.error("[Camera] play() rejected:", err);
                onStatusChange?.("engine-error");
              });
          };
        }
      } catch (err) {
        if (cancelled) return;
        if (err?.code === VIRTUAL_ONLY) {
          logger.warn("[Camera] Only a virtual camera is available");
          onStatusChange?.("virtual-camera");
          return;
        }
        logger.error("[Camera] Boot failed:", err);
        onStatusChange?.("engine-error");
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [videoRef, onStatusChange]);

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      className="h-[320px] w-full object-cover scale-x-[-1] rounded-2xl shadow-xl"
    />
  );
}
