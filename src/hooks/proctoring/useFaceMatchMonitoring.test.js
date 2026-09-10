import { renderHook, waitFor } from "@testing-library/react";
import { useFaceMatchMonitoring } from "./useFaceMatchMonitoring";
import { TERMINATION_REASONS } from "@/lib/terminationReasons";
import { subscribeToViolationLog } from "@/lib/violationLog";

const mockUseContinuousVerify = vi.fn();

vi.mock("@queries/useContinuousVerify", () => ({
  useContinuousVerify: (...args) => mockUseContinuousVerify(...args),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const MATCH = { same_person: true };
const MISMATCH = { same_person: false };

function setup() {
  const autoSubmit = vi.fn();
  let clock = 0;

  mockUseContinuousVerify.mockReturnValue({ data: undefined, dataUpdatedAt: 0 });

  const { rerender, result } = renderHook(() =>
    useFaceMatchMonitoring({ sessionId: "s1", captureImage: () => null, autoSubmit }),
  );

  // The same object reference on purpose: React Query hands back the previous
  // one when two polls agree, so only dataUpdatedAt moves.
  const poll = async (data, times = 1) => {
    for (let i = 0; i < times; i += 1) {
      clock += 5000;
      mockUseContinuousVerify.mockReturnValue({ data, dataUpdatedAt: clock });
      rerender();
      await waitFor(() => {});
    }
  };

  return { autoSubmit, poll, result };
}

describe("useFaceMatchMonitoring", () => {
  beforeEach(() => {
    mockUseContinuousVerify.mockReset();
  });

  it("does not end the interview on two mismatched frames", async () => {
    const { autoSubmit, poll, result } = setup();

    await poll(MISMATCH, 2);

    expect(autoSubmit).not.toHaveBeenCalled();
    expect(result.current.mismatchCount).toBe(0);
  });

  it("counts one mismatch once the window confirms it", async () => {
    const { autoSubmit, poll, result } = setup();

    await poll(MISMATCH, 3);

    await waitFor(() => expect(result.current.mismatchCount).toBe(1));
    expect(autoSubmit).not.toHaveBeenCalled();
  });

  it("ends the interview after the configured number of confirmed mismatches", async () => {
    const { autoSubmit, poll } = setup();

    await poll(MISMATCH, 6);

    await waitFor(() => expect(autoSubmit).toHaveBeenCalledTimes(1));
    expect(autoSubmit).toHaveBeenCalledWith(TERMINATION_REASONS.FACE_MISMATCH);
  });

  it("submits once even as further results arrive", async () => {
    const { autoSubmit, poll } = setup();

    await poll(MISMATCH, 10);

    expect(autoSubmit).toHaveBeenCalledTimes(1);
  });

  it("clears the evidence on a successful verification", async () => {
    const { autoSubmit, poll, result } = setup();

    await poll(MISMATCH, 2);
    await poll(MATCH, 1);
    await poll(MISMATCH, 2);

    expect(result.current.mismatchCount).toBe(0);
    expect(autoSubmit).not.toHaveBeenCalled();
  });

  it("does not count a tick with no captured frame", async () => {
    const { autoSubmit, poll, result } = setup();

    await poll({ no_sample: true }, 6);

    expect(result.current.mismatchCount).toBe(0);
    expect(autoSubmit).not.toHaveBeenCalled();
  });

  it("does not count a frame too poor to judge", async () => {
    const { autoSubmit, poll, result } = setup();

    await poll({ same_person: false, frame_quality: 0.1 }, 6);

    expect(result.current.mismatchCount).toBe(0);
    expect(autoSubmit).not.toHaveBeenCalled();
  });

  it("records every decision, including the termination", async () => {
    const events = [];
    const unsubscribe = subscribeToViolationLog((event) => events.push(event));

    const { poll } = setup();
    await poll(MISMATCH, 6);
    await waitFor(() => expect(events.some((e) => e.outcome === "terminated")).toBe(true));
    unsubscribe();

    expect(events.filter((e) => e.outcome === "unconfirmed").length).toBeGreaterThan(0);
    expect(events.filter((e) => e.outcome === "raised")).toHaveLength(2);
    expect(events.find((e) => e.outcome === "terminated")).toMatchObject({
      source: "face_match",
      type: "FACE_MISMATCH",
      violation_count: 2,
    });
  });
});
