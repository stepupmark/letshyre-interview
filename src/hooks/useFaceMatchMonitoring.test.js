import { renderHook, waitFor } from "@testing-library/react";
import { useFaceMatchMonitoring } from "./useFaceMatchMonitoring";
import { TERMINATION_REASONS } from "@/lib/terminationReasons";

const mockUseContinuousVerify = vi.fn();

vi.mock("@queries/useContinuousVerify", () => ({
  useContinuousVerify: (...args) => mockUseContinuousVerify(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

function setVerifyData(data) {
  mockUseContinuousVerify.mockReturnValue({ data });
}

describe("useFaceMatchMonitoring", () => {
  beforeEach(() => {
    mockUseContinuousVerify.mockReset();
  });

  it("auto-submits after 2 consecutive face mismatches", async () => {
    const autoSubmit = vi.fn();
    setVerifyData(undefined);

    const { rerender } = renderHook(() =>
      useFaceMatchMonitoring({ sessionId: "s1", captureImage: () => null, autoSubmit }),
    );

    setVerifyData({ same_person: false });
    rerender();

    await waitFor(() => {
      // wait for first mismatch to register
    });

    setVerifyData({ same_person: false, marker: 2 });
    rerender();

    await waitFor(() => expect(autoSubmit).toHaveBeenCalledTimes(1));

    expect(autoSubmit).toHaveBeenCalledWith(TERMINATION_REASONS.FACE_MISMATCH);
  });

  it("resets the mismatch count on a same_person:true result", async () => {
    const autoSubmit = vi.fn();
    setVerifyData(undefined);

    const { result, rerender } = renderHook(() =>
      useFaceMatchMonitoring({ sessionId: "s1", captureImage: () => null, autoSubmit }),
    );

    // One mismatch
    setVerifyData({ same_person: false });
    rerender();
    await waitFor(() => expect(result.current.mismatchCount).toBe(1));

    // Successful verification resets the count
    setVerifyData({ same_person: true });
    rerender();
    await waitFor(() => expect(result.current.mismatchCount).toBe(0));

    // A single mismatch after reset should not trigger auto-submit
    setVerifyData({ same_person: false, marker: "after-reset" });
    rerender();
    await waitFor(() => expect(result.current.mismatchCount).toBe(1));

    expect(autoSubmit).not.toHaveBeenCalled();
  });

  it("does not count no_sample results as mismatches", async () => {
    const autoSubmit = vi.fn();
    setVerifyData(undefined);

    const { result, rerender } = renderHook(() =>
      useFaceMatchMonitoring({ sessionId: "s1", captureImage: () => null, autoSubmit }),
    );

    setVerifyData({ no_sample: true });
    rerender();

    setVerifyData({ no_sample: true, marker: 2 });
    rerender();

    // Give any pending microtasks a chance to run.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(result.current.mismatchCount).toBe(0);
    expect(autoSubmit).not.toHaveBeenCalled();
  });
});
