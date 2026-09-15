import { useMutation } from "@tanstack/react-query";
import { continuousVerify } from "@/services/face.api";

export const useContinuousVerifyMutation = (sessionId) => {
  return useMutation({
    mutationFn: ({ imageFile }) => continuousVerify({ session_id: sessionId, imageFile }),
    retry: false,
  });
};
