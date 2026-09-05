import { useMutation } from "@tanstack/react-query";
import { submitAnswer } from "@/services/interview.api";

export function useSubmitAnswerMutation() {
  return useMutation({
    mutationFn: async (formData) => {
      const response = await submitAnswer(formData);
      return response;
    },
  });
}
