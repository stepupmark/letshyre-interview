import { act, renderHook, waitFor } from "@testing-library/react";
import { useAutoSubmitFlow } from "./useAutoSubmitFlow";
import { TERMINATION_REASONS } from "@/lib/terminationReasons";
import { MAX_INTERNET_DISCONNECTS, SESSION_STATUS } from "@/config/interview";

const mutateAsync = vi.fn();

vi.mock("@mutations/useAutoSubmitMutation", () => ({
  useAutoSubmitMutation: () => ({ mutateAsync }),
}));

const VIOLATIONS_ALLOWED = 3;

const SUCCESS_RESPONSE = {
  success: true,
  data: { ai: { total_score: 8 }, scorecard: { total: 8 } },
};

function activeSession(overrides = {}) {
  return {
    interview_id: "i1",
    session_id: "s1",
    status: SESSION_STATUS.ACTIVE,
    violations: 0,
    internet_disconnect_count: 0,
    ...overrides,
  };
}

function setup({ session, timeLeft = 600 } = {}) {
  const setSession = vi.fn();
  const utils = renderHook(() =>
    useAutoSubmitFlow({
      session,
      setSession,
      timeLeft,
      violationsAllowed: VIOLATIONS_ALLOWED,
    }),
  );
  return { ...utils, setSession };
}

describe("useAutoSubmitFlow triggers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateAsync.mockResolvedValue(SUCCESS_RESPONSE);
  });

  it("submits with TIME_EXPIRED when the timer runs out", async () => {
    const { result } = setup({ session: activeSession(), timeLeft: 0 });

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(result.current.autoSubmitReason).toBe(TERMINATION_REASONS.TIME_EXPIRED);
  });

  it("submits with VIOLATION_LIMIT when violations reach the allowance", async () => {
    const { result } = setup({
      session: activeSession({ violations: VIOLATIONS_ALLOWED }),
    });

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(result.current.autoSubmitReason).toBe(TERMINATION_REASONS.VIOLATION_LIMIT);
  });

  it("submits with NETWORK_DISCONNECTS when disconnects reach the limit", async () => {
    const { result } = setup({
      session: activeSession({ internet_disconnect_count: MAX_INTERNET_DISCONNECTS }),
    });

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(result.current.autoSubmitReason).toBe(TERMINATION_REASONS.NETWORK_DISCONNECTS);
  });

  it("stays put while time remains and no limit is reached", async () => {
    setup({ session: activeSession(), timeLeft: 120 });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("does not submit one violation short of the allowance", async () => {
    setup({ session: activeSession({ violations: VIOLATIONS_ALLOWED - 1 }) });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("does not re-submit a session that already completed", async () => {
    setup({
      session: activeSession({ status: SESSION_STATUS.COMPLETED, violations: 99 }),
      timeLeft: 0,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("resumes a restored expired session that never got a scorecard", async () => {
    setup({ session: activeSession({ status: SESSION_STATUS.EXPIRED }) });

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
  });

  it("leaves a restored expired session alone once it has a scorecard", async () => {
    setup({
      session: activeSession({ status: SESSION_STATUS.EXPIRED, scorecard: { total: 5 } }),
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});

describe("useAutoSubmitFlow submission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateAsync.mockResolvedValue(SUCCESS_RESPONSE);
  });

  it("freezes the session to EXPIRED before calling the API", async () => {
    const { setSession } = setup({ session: activeSession(), timeLeft: 0 });

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());

    const updater = setSession.mock.calls[0][0];
    expect(updater(activeSession())).toMatchObject({ status: SESSION_STATUS.EXPIRED });
  });

  it("sends the interview and session ids", async () => {
    setup({ session: activeSession(), timeLeft: 0 });

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith({ interview_id: "i1", session_id: "s1" });
  });

  it("flags success once the response is parsed", async () => {
    const { result } = setup({ session: activeSession(), timeLeft: 0 });

    await waitFor(() => expect(result.current.autoSubmitSuccess).toBe(true));
    expect(result.current.autoSubmitError).toBeNull();
  });

  it("surfaces the server message when submission fails", async () => {
    mutateAsync.mockRejectedValue({ response: { data: { message: "Server exploded" } } });
    const { result } = setup({ session: activeSession(), timeLeft: 0 });

    await waitFor(() => expect(result.current.autoSubmitError).toBe("Server exploded"));
  });

  it("treats a malformed response as a failure", async () => {
    mutateAsync.mockResolvedValue({ success: false });
    const { result } = setup({ session: activeSession(), timeLeft: 0 });

    await waitFor(() => expect(result.current.autoSubmitError).toBe("Invalid auto submit response"));
  });

  it("submits once when every trigger fires in the same render", async () => {
    const { result } = setup({
      session: activeSession({
        violations: VIOLATIONS_ALLOWED,
        internet_disconnect_count: MAX_INTERNET_DISCONNECTS,
      }),
      timeLeft: 0,
    });

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    await waitFor(() => expect(result.current.autoSubmitSuccess).toBe(true));

    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("still allows a retry after a failure", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("Server exploded"));
    const { result } = setup({ session: activeSession(), timeLeft: 0 });

    await waitFor(() => expect(result.current.autoSubmitError).toBe("Server exploded"));

    mutateAsync.mockResolvedValue(SUCCESS_RESPONSE);
    await act(async () => {
      await result.current.autoSubmit(TERMINATION_REASONS.TIME_EXPIRED);
    });

    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(result.current.autoSubmitSuccess).toBe(true);
  });

  it("blames connectivity only when the browser is actually offline", async () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    mutateAsync.mockRejectedValue(new Error("Network Error"));

    const { result } = setup({ session: activeSession(), timeLeft: 0 });

    await waitFor(() => expect(result.current.autoSubmitError).toMatch(/offline/i));
    onLine.mockRestore();
  });
});
