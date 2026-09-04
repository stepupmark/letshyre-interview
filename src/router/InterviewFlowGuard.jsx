import { Outlet } from "react-router";

// Pathless layout route that wraps private pages. Token presence is already
// enforced by privateLoader; this component simply renders children/outlet.
export function InterviewFlowGuard({ children }) {
  return children || <Outlet />;
}
