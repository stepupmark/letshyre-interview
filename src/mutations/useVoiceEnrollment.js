import { useMutation } from "@tanstack/react-query";
import { enrollVoice } from "@/services/interview.api";

const ENROLLMENT_KEY = "voice_enrollment_id";

/**
 * Enrolls the candidate's voice once per interview session.
 * The enrollment_id is persisted in sessionStorage so it survives re-renders
 * but is cleared when the tab closes.
 */
export function useVoiceEnrollment() {
  const cached = sessionStorage.getItem(ENROLLMENT_KEY);

  const mutation = useMutation({
    mutationFn: enrollVoice,
    onSuccess: (data) => {
      const enrollmentId = data?.data?.enrollment_id;
      if (enrollmentId) {
        sessionStorage.setItem(ENROLLMENT_KEY, enrollmentId);
      }
    },
  });

  return {
    enroll: mutation.mutate,
    enrollAsync: mutation.mutateAsync,
    enrollmentId: cached || mutation.data?.data?.enrollment_id || null,
    isEnrolling: mutation.isPending,
    isEnrolled: !!cached || !!mutation.data?.data?.enrollment_id,
    enrollError: mutation.error,
  };
}
