import { renderHook, act, waitFor } from "@testing-library/react";
import { useInterviewSession } from "./useInterviewSession";

const startMutateAsync = vi.fn();
const submitMutateAsync = vi.fn();
const autoSubmitMutateAsync = vi.fn();

vi.mock("./useStartInterviewMutation", () => ({
  useStartInterviewMutation: () => ({
    mutateAsync: startMutateAsync,
    isPending: false,
  }),
}));

vi.mock("./useSubmitAnswerMutation", () => ({
  useSubmitAnswerMutation: () => ({
    mutateAsync: submitMutateAsync,
    isPending: false,
  }),
}));

vi.mock("./useAutoSubmitMutation", () => ({
  useAutoSubmitMutation: () => ({
    mutateAsync: autoSubmitMutateAsync,
    isPending: false,
  }),
}));

const FAKE_START_RESPONSE = {
  success: true,
  data: {
    interview_id: "interview-123",
    session_id: "session-456",
    proctoring_token: "token-789",
    ai: {
      question: { id: "q1", text: "Tell me about yourself." },
    },
  },
};

describe("useInterviewSession", () => {
  beforeEach(() => {
    sessionStorage.clear();
    startMutateAsync.mockReset();
    submitMutateAsync.mockReset();
    autoSubmitMutateAsync.mockReset();

    startMutateAsync.mockResolvedValue(FAKE_START_RESPONSE);
    autoSubmitMutateAsync.mockResolvedValue({
      success: true,
      data: { ai: { completed: true, scorecard: { score: 10 } } },
    });
  });

  it("starts a new session and becomes active", async () => {
    const { result } = renderHook(() => useInterviewSession());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.session).not.toBeNull();
    expect(result.current.isActive).toBe(true);
    expect(result.current.session.violations).toBe(0);
  });

  it("auto-submits once violations reach the 3-strike limit", async () => {
    const { result } = renderHook(() => useInterviewSession());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isActive).toBe(true);

    await act(async () => {
      result.current.incrementViolation();
    });
    await act(async () => {
      result.current.incrementViolation();
    });
    await act(async () => {
      result.current.incrementViolation();
    });

    // Auto-submit is deferred via queueMicrotask; give it a tick to fire.
    await waitFor(() => expect(autoSubmitMutateAsync).toHaveBeenCalledTimes(1));

    expect(autoSubmitMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        interview_id: "interview-123",
        session_id: "session-456",
      }),
    );
  });

  it("does not auto-submit after only one or two violations", async () => {
    const { result } = renderHook(() => useInterviewSession());

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.incrementViolation();
    });
    await act(async () => {
      result.current.incrementViolation();
    });

    // Flush any pending microtasks so a wrongly-firing auto-submit would show up.
    await act(async () => {
      await Promise.resolve();
    });

    expect(autoSubmitMutateAsync).not.toHaveBeenCalled();
    expect(result.current.session.violations).toBe(2);
  });

  it("incrementViolation is a no-op and returns 0 when the session is not active", async () => {
    const { result } = renderHook(() => useInterviewSession());

    // Session hasn't loaded yet — not active.
    let returnValue;
    act(() => {
      returnValue = result.current.incrementViolation();
    });
    expect(returnValue).toBe(0);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isActive).toBe(true);

    // Terminate, then verify incrementViolation is a no-op post-termination.
    act(() => {
      result.current.terminateSession();
    });
    await waitFor(() => expect(result.current.isActive).toBe(false));

    let afterTerminate;
    act(() => {
      afterTerminate = result.current.incrementViolation();
    });
    expect(afterTerminate).toBe(0);
  });
});
