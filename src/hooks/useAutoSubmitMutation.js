import { useMutation } from "@tanstack/react-query";
import { autoSubmitInterview } from "@/services/interview.api";

export function useAutoSubmitMutation() {
  return useMutation({
    mutationFn: async (payload) => {
      const response = await autoSubmitInterview(payload);
      return response;
    },
  });
}
