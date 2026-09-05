import { useMutation } from "@tanstack/react-query";
import { registerFace } from "@/services/face.api";

export const useRegisterFace = (sessionId, onSuccess, onError) => {
  return useMutation({
    mutationFn: ({ imageFile }) => registerFace({ session_id: sessionId, imageFile }),
    retry: 3,
    onSuccess,
    onError,
  });
};
