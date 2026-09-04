import { Component } from "react";
import { logger } from "@/lib/logger";
import i18next from "@/i18n";

/**
 * Component-level error boundary. Catches render errors in a subtree and shows
 * a recoverable fallback instead of unmounting the whole page — so a crash in
 * the question panel or scorecard doesn't take down the camera, proctoring, or
 * the header along with it.
 *
 * Pass a custom `fallback` (node) to override the default UI.
 */
export class ErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    logger.error("[ErrorBoundary] caught:", error, info?.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <h2 className="text-lg font-semibold text-slate-800">
          {i18next.t("errors:boundary.heading")}
        </h2>
        <p className="max-w-sm text-sm text-slate-500">{i18next.t("errors:boundary.description")}</p>
        <button
          type="button"
          onClick={this.handleReset}
          className="rounded-xl bg-slate-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-900"
        >
          {i18next.t("errors:boundary.tryAgain")}
        </button>
      </div>
    );
  }
}
