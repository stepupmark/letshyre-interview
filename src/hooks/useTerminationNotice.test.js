import { act, renderHook } from "@testing-library/react";
import { useTerminationNotice } from "./useTerminationNotice";
import { TERMINATION_REASONS } from "@/lib/terminationReasons";
import { TERMINATION_NOTICE_SECONDS } from "@/config/interview";

describe("useTerminationNotice", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stays hidden for a non-termination reason", () => {
    const { result } = renderHook(() => useTerminationNotice("Resuming expired session"));
    expect(result.current.visible).toBe(false);
  });

  it("stays hidden when there is no reason yet", () => {
    const { result } = renderHook(() => useTerminationNotice(undefined));
    expect(result.current.visible).toBe(false);
  });

  it("shows for a termination reason and counts down", () => {
    const { result } = renderHook(() =>
      useTerminationNotice(TERMINATION_REASONS.VIOLATION_LIMIT),
    );

    expect(result.current.visible).toBe(true);
    expect(result.current.secondsLeft).toBe(TERMINATION_NOTICE_SECONDS);

    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.secondsLeft).toBe(TERMINATION_NOTICE_SECONDS - 1);
  });

  it("hides on its own once the countdown expires", () => {
    const { result } = renderHook(() =>
      useTerminationNotice(TERMINATION_REASONS.VIOLATION_LIMIT),
    );

    act(() => vi.advanceTimersByTime(TERMINATION_NOTICE_SECONDS * 1000));

    expect(result.current.secondsLeft).toBe(0);
    expect(result.current.visible).toBe(false);
  });

  it("hides immediately when acknowledged", () => {
    const { result } = renderHook(() =>
      useTerminationNotice(TERMINATION_REASONS.FACE_MISMATCH),
    );

    act(() => result.current.acknowledge());

    expect(result.current.visible).toBe(false);
  });

  it("does not reappear after acknowledgement", () => {
    const { result } = renderHook(() =>
      useTerminationNotice(TERMINATION_REASONS.NETWORK_DISCONNECTS),
    );

    act(() => result.current.acknowledge());
    act(() => vi.advanceTimersByTime(3000));

    expect(result.current.visible).toBe(false);
  });
});
