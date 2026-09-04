import { useMutation } from "@tanstack/react-query";
import { fetchQuestion } from "@/services/interview.api";

export function useStartInterviewMutation() {
  return useMutation({
    mutationFn: async (payload) => {
      const response = await fetchQuestion(payload);
      return response;
    },
  });
}
