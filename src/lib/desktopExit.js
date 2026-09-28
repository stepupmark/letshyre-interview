import { INTERVIEW_SESSION_STORAGE_KEY, SESSION_STATUS } from "@/config/interview";

// Builds without abortInterview open the dashboard over a lockdown that is
// still being released, so they get a moment first.
const LEGACY_RELEASE_MS = 1500;

export const inDesktopApp = () =>
  typeof window !== "undefined" && typeof window.electronAPI?.interviewComplete === "function";

export function hasActiveInterview() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(INTERVIEW_SESSION_STORAGE_KEY) || "null");
    return saved?.status === SESSION_STATUS.ACTIVE;
  } catch {
    return false;
  }
}

/** Lifts the lockdown for an interview that is over or never started. */
export function releaseDesktop(reason) {
  window.electronAPI?.interviewComplete?.(reason);
}

/**
 * Back to the desktop app's dashboard. `endSession` is for an interview that
 * can't go on at all (signed out); anything else is refused by the app once
 * the interview is running.
 */
export function leaveToDashboard(reason, { endSession = false } = {}) {
  const api = window.electronAPI;
  if (!api) return;
  const canAbort = typeof api.abortInterview === "function";
  if (canAbort && !endSession) {
    api.abortInterview(reason);
    return;
  }
  api.interviewComplete?.(reason);
  setTimeout(() => api.viewDashboard?.(), canAbort ? 0 : LEGACY_RELEASE_MS);
}
