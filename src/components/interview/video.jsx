import { useEffect, useRef } from "react";

export default function CandidateCameraCard({ videoRef, onStatusChange }) {
  const streamRef = useRef(null);

  // Boot webcam on mount
  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 1280, height: 720 },
          audio: false,
        });

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
                console.error("[Camera] play() rejected:", err);
                onStatusChange?.("engine-error");
              });
          };
        }
      } catch (err) {
        console.error("[Camera] Boot failed:", err);
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
