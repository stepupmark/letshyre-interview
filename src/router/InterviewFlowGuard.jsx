import { Outlet } from "react-router";
import { MIN_DESKTOP_VERSION } from "@/config/interview";
import { isOutdatedDesktop } from "@/lib/desktopVersion";
import { DesktopUpdateRequired } from "@/components/interview/DesktopUpdateRequired";

// Pathless layout route that wraps private pages. Token presence is already
// enforced by privateLoader. A desktop app too old to lock the screen properly
// is stopped here, before the interview starts.
export function InterviewFlowGuard({ children }) {
  const outdated = isOutdatedDesktop({
    userAgent: navigator.userAgent,
    isDesktop: typeof window.electronAPI?.onViolation === "function",
    minVersion: MIN_DESKTOP_VERSION,
  });
  if (outdated) return <DesktopUpdateRequired />;
  return children || <Outlet />;
}
