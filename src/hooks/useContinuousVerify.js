import { useQuery } from "@tanstack/react-query";
import { continuousVerify } from "@/services/faceApi";

export const useContinuousVerify = (sessionId, getImageFile, isMonitoringStopped, isReady = true) => {
  return useQuery({
    queryKey: ["continuous-verify", sessionId],

    queryFn: async () => {
      const imageFile = getImageFile();

      // No frame yet (camera still warming up). Return a sentinel the monitor
      // treats as "no sample" — NOT as an identity mismatch.
      if (!imageFile) {
        return { no_sample: true };
      }

      return continuousVerify({
        session_id: sessionId,
        imageFile,
      });
    },

    // Only poll once the reference face is registered and the camera is ready,
    // so warm-up frames can't be scored as mismatches.
    enabled: !!sessionId && !isMonitoringStopped && isReady,

    refetchInterval: isMonitoringStopped ? false : 5000,

    refetchIntervalInBackground: true,

    retry: false,
  });
};
