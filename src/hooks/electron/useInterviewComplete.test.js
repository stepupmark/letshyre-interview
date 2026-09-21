import { renderHook } from "@testing-library/react";
import { useInterviewComplete } from "./useInterviewComplete";
import { TERMINATION_REASONS } from "@/lib/terminationReasons";

const base = {
  isCompleted: false,
  isTerminated: false,
  isExpired: false,
  autoSubmitSuccess: false,
  autoSubmitReason: "",
};

describe("useInterviewComplete", () => {
  let interviewComplete;

  beforeEach(() => {
    interviewComplete = vi.fn();
    window.electronAPI = { interviewComplete };
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  it("stays quiet while the interview is running", () => {
    renderHook(() => useInterviewComplete(base));
    expect(interviewComplete).not.toHaveBeenCalled();
  });

  it("reports a normal finish as completed", () => {
    renderHook(() => useInterviewComplete({ ...base, isCompleted: true }));
    expect(interviewComplete).toHaveBeenCalledWith("completed");
  });

  it("reports why an auto-submit ended the interview instead of expired", () => {
    renderHook(() =>
      useInterviewComplete({
        ...base,
        isExpired: true,
        autoSubmitReason: TERMINATION_REASONS.ELECTRON_SECURITY,
      }),
    );
    expect(interviewComplete).toHaveBeenCalledWith(TERMINATION_REASONS.ELECTRON_SECURITY);
  });

  it("falls back to expired for a restored session with no reason", () => {
    renderHook(() => useInterviewComplete({ ...base, isExpired: true }));
    expect(interviewComplete).toHaveBeenCalledWith("expired");
  });

  it("signals only once", () => {
    const { rerender } = renderHook((props) => useInterviewComplete(props), {
      initialProps: { ...base, isExpired: true, autoSubmitReason: "time_expired" },
    });
    rerender({ ...base, isCompleted: true, autoSubmitReason: "time_expired" });
    expect(interviewComplete).toHaveBeenCalledTimes(1);
  });
});
