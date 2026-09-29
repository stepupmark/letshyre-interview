import { StrictMode } from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { useInterviewSession } from "./useInterviewSession";
import { MAX_INTERNET_DISCONNECTS, SESSION_STATUS } from "@/config/interview";
import { subscribeToViolationLog } from "@/lib/violationLog";

const startMutateAsync = vi.fn();
const submitMutateAsync = vi.fn();
const autoSubmitMutateAsync = vi.fn();

vi.mock("@/config/interview", async (importOriginal) => ({
  ...(await importOriginal()),
  START_RETRY_DELAY_MS: 0,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@mutations/useStartInterviewMutation", () => ({
  useStartInterviewMutation: () => ({
    mutateAsync: startMutateAsync,
    isPending: false,
  }),
}));

vi.mock("@mutations/useSubmitAnswerMutation", () => ({
  useSubmitAnswerMutation: () => ({
    mutateAsync: submitMutateAsync,
    isPending: false,
  }),
}));

vi.mock("@mutations/useAutoSubmitMutation", () => ({
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
    toast.error.mockClear();
    toast.success.mockClear();
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

  it("raises one strike per disconnect, even though StrictMode replays updaters", async () => {
    const { result } = renderHook(() => useInterviewSession(), { wrapper: StrictMode });

    await waitFor(() => expect(result.current.loading).toBe(false));
    toast.error.mockClear();

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    await waitFor(() => expect(result.current.session.internet_disconnect_count).toBe(1));
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error.mock.calls[0][0]).toContain("Strike 1 of 3");

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    await waitFor(() => expect(result.current.session.internet_disconnect_count).toBe(2));
    expect(toast.error).toHaveBeenCalledTimes(2);
    expect(toast.error.mock.calls[1][0]).toContain("Strike 2 of 3");
  });
});

describe("useInterviewSession submit", () => {
  beforeEach(() => {
    sessionStorage.clear();
    startMutateAsync.mockReset().mockResolvedValue(FAKE_START_RESPONSE);
    submitMutateAsync.mockReset().mockResolvedValue({
      success: true,
      data: { ai: { current_index: 2, next_question: { text: "Next" } } },
    });
  });

  const ready = async () => {
    const hook = renderHook(() => useInterviewSession());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    return hook;
  };

  it.each([
    ["code_answer", "return s[::-1]"],
    ["answer_text", "I build APIs."],
    ["selected_option", "B. O(n)"],
  ])("sends %s as the answer field", async (field, value) => {
    const { result } = await ready();

    await act(() => result.current.submit({ [field]: value }));

    expect(submitMutateAsync).toHaveBeenCalledWith({
      interview_id: "interview-123",
      session_id: "session-456",
      answer: value,
    });
  });

  it("refuses to send a request without an answer", async () => {
    const { result } = await ready();

    await expect(act(() => result.current.submit({ code_answer: "   " }))).rejects.toThrow();
    await expect(act(() => result.current.submit({}))).rejects.toThrow();
    expect(submitMutateAsync).not.toHaveBeenCalled();
  });

  it("drops the saved draft once the answer is accepted", async () => {
    const { result } = await ready();
    const key = "answer_draft:interview-123:1";
    sessionStorage.setItem(key, "draft");

    await act(() => result.current.submit({ code_answer: "draft" }));

    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it("marks an interview finished by the last answer as completed", async () => {
    submitMutateAsync.mockResolvedValue({
      success: true,
      data: { ai: { completed: true, scorecard: { overall_score: 50 } } },
    });
    const { result } = await ready();

    await act(() => result.current.submit({ answer_text: "last" }));

    expect(result.current.session).toMatchObject({
      status: SESSION_STATUS.COMPLETED,
      end_reason: "completed",
    });
  });
});

describe("useInterviewSession log", () => {
  let events;
  let stop;

  beforeEach(() => {
    sessionStorage.clear();
    startMutateAsync.mockReset().mockResolvedValue(FAKE_START_RESPONSE);
    events = [];
    stop = subscribeToViolationLog((event) => events.push(event));
  });

  afterEach(() => stop());

  it("logs each disconnect and how long it lasted", async () => {
    const { result } = renderHook(() => useInterviewSession());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => window.dispatchEvent(new Event("offline")));
    act(() => window.dispatchEvent(new Event("online")));

    const network = events.filter((event) => event.type === "NETWORK_DISCONNECT");
    expect(network).toEqual([
      expect.objectContaining({
        outcome: "raised",
        disconnect_count: 1,
        limit: MAX_INTERNET_DISCONNECTS,
        category: "network",
      }),
      expect.objectContaining({ outcome: "restored", offline_ms: expect.any(Number) }),
    ]);
  });

  it("records a normal finish", async () => {
    submitMutateAsync.mockReset().mockResolvedValue({
      success: true,
      data: { ai: { completed: true, scorecard: { overall_score: 50 } } },
    });
    const { result } = renderHook(() => useInterviewSession());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.submit({ answer_text: "last" }));

    expect(events.filter((event) => event.type === "INTERVIEW_ENDED")).toEqual([
      expect.objectContaining({ outcome: "completed", reason: "completed", strike_count: 0 }),
    ]);
  });
});

describe("useInterviewSession start failure", () => {
  beforeEach(() => {
    sessionStorage.clear();
    startMutateAsync.mockReset();
  });

  const httpError = (status, message) =>
    Object.assign(new Error(message), {
      response: { status, data: { success: false, status, message, data: null } },
    });

  it("stops loading and says why when no attempts are left", async () => {
    startMutateAsync.mockRejectedValue(
      httpError(400, "Maximum 3 attempts completed. You cannot take more interviews."),
    );
    const { result } = renderHook(() => useInterviewSession());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.session).toBeNull();
    expect(result.current.startFailure.kind).toBe("exhausted");
    expect(startMutateAsync).toHaveBeenCalledTimes(1);
  });

  it("retries a dropped connection once before giving up", async () => {
    startMutateAsync.mockRejectedValue(new Error("Network Error"));
    const { result } = renderHook(() => useInterviewSession());

    await waitFor(() => expect(result.current.startFailure?.kind).toBe("network"));
    expect(startMutateAsync).toHaveBeenCalledTimes(2);
  });

  it("recovers when the quiet retry works", async () => {
    startMutateAsync
      .mockRejectedValueOnce(httpError(503, "Unavailable"))
      .mockResolvedValue(FAKE_START_RESPONSE);
    const { result } = renderHook(() => useInterviewSession());

    await waitFor(() => expect(result.current.isActive).toBe(true));
    expect(result.current.startFailure).toBeNull();
  });

  it("treats a success:false body as a failure, and can try again", async () => {
    startMutateAsync.mockResolvedValueOnce({ success: false, status: 400, message: "Bad role" });
    const { result } = renderHook(() => useInterviewSession());

    await waitFor(() => expect(result.current.startFailure?.kind).toBe("rejected"));

    startMutateAsync.mockResolvedValue(FAKE_START_RESPONSE);
    await act(() => result.current.retryStart());
    expect(result.current.isActive).toBe(true);
    expect(result.current.startFailure).toBeNull();
  });

  describe("holdStart", () => {
    beforeEach(() => startMutateAsync.mockResolvedValue(FAKE_START_RESPONSE));

    it("waits for beginStart before starting, so the clock can't run early", async () => {
      const { result } = renderHook(() => useInterviewSession({ holdStart: true }));

      await waitFor(() => expect(result.current.awaitingStart).toBe(true));
      expect(startMutateAsync).not.toHaveBeenCalled();
      expect(result.current.session).toBeNull();

      const before = Date.now();
      await act(() => result.current.beginStart());
      expect(result.current.awaitingStart).toBe(false);
      expect(result.current.isActive).toBe(true);
      expect(result.current.session.end_time).toBeGreaterThanOrEqual(before);
      expect(startMutateAsync).toHaveBeenCalledTimes(1);
    });

    it("restores a session in progress without waiting", async () => {
      sessionStorage.setItem(
        "interview_session",
        JSON.stringify({
          interview_id: "i-1",
          session_id: "s-1",
          end_time: Date.now() + 60_000,
          status: SESSION_STATUS.ACTIVE,
        }),
      );
      const { result } = renderHook(() => useInterviewSession({ holdStart: true }));

      await waitFor(() => expect(result.current.isActive).toBe(true));
      expect(result.current.awaitingStart).toBe(false);
      expect(startMutateAsync).not.toHaveBeenCalled();
    });
  });
});
