import { useMutation } from "@tanstack/react-query";
import { compareVoice } from "@/services/interview.api";

/**
 * Compares a live voice recording against the enrolled voice sample.
 *
 * @param {(data: object) => void} onSuccess - Called with the full API response on success.
 * @param {(error: object) => void} onError   - Called with the error on failure.
 */
export function useVoiceCompare(onSuccess, onError) {
  const mutation = useMutation({
    mutationFn: ({ audioBlob, enrollmentId, threshold = 0.6 }) => {
      const formData = new FormData();

      let ext = "webm";
      if (audioBlob.type?.includes("mp4")) ext = "mp4";
      if (audioBlob.type?.includes("ogg")) ext = "ogg";
      if (audioBlob.type?.includes("wav")) ext = "wav";
      if (audioBlob.type?.includes("mpeg") || audioBlob.type?.includes("mp3")) ext = "mp3";

      formData.append("live_voice", audioBlob, `live_voice.${ext}`);
      formData.append("threshold", String(threshold));

      if (enrollmentId) {
        formData.append("enrollment_id", enrollmentId);
      }

      return compareVoice(formData);
    },
    onSuccess: (data) => onSuccess?.(data),
    onError: (error) => onError?.(error),
  });

  return {
    compare: mutation.mutate,
    isComparing: mutation.isPending,
    compareResult: mutation.data?.data ?? null,
    compareError: mutation.error,
    reset: mutation.reset,
  };
}
