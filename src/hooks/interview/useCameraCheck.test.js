import { act, renderHook } from "@testing-library/react";
import { useCameraCheck } from "./useCameraCheck";
import { startLocalWatch } from "@hooks/proctoring/localWatch";
import {
  CAMERA_CHECK_ATTEMPT_MS,
  CAMERA_CHECK_HOLD_MS,
  CAMERA_CHECK_MAX_ATTEMPTS,
  CAMERA_CHECK_START_TIMEOUT_MS,
} from "@/config/interview";

vi.mock("@hooks/proctoring/localWatch", () => ({ startLocalWatch: vi.fn() }));
vi.mock("@/lib/localFaceDetector", () => ({ loadFaceDetector: vi.fn() }));

const good = { oneFace: true, centred: true, bright: true };
const dark = { ...good, bright: false };

let watch;
beforeEach(() => {
  vi.useFakeTimers();
  startLocalWatch.mockReset();
  startLocalWatch.mockImplementation((options) => {
    watch = { ...options, stop: vi.fn() };
    return watch.stop;
  });
});
afterEach(() => vi.useRealTimers());

const setup = () => {
  const videoRef = { current: null };
  return renderHook(() => useCameraCheck(videoRef));
};
const feed = (checks, at) => act(() => watch.onResult({ ...checks, at }));

describe("useCameraCheck", () => {
  it("passes once every check has held long enough, then stops watching", () => {
    const { result } = setup();
    expect(result.current.status).toBe("starting");

    feed(good, 0);
    expect(result.current.status).toBe("checking");
    feed(good, CAMERA_CHECK_HOLD_MS - 1);
    expect(result.current.canContinue).toBe(false);
    feed(good, CAMERA_CHECK_HOLD_MS);

    expect(result.current.status).toBe("passed");
    expect(result.current.canContinue).toBe(true);
    expect(result.current.outcome).toEqual({ passed: true, failed_attempts: 0 });
    expect(watch.stop).toHaveBeenCalled();
  });

  it("starts the hold again when a check drops out", () => {
    const { result } = setup();
    feed(good, 0);
    feed(dark, 1000);
    feed(good, 1100);
    feed(good, 1100 + CAMERA_CHECK_HOLD_MS - 1);
    expect(result.current.status).toBe("checking");
    expect(result.current.checks).toEqual(good);
  });

  it("lets the candidate skip after the last failed attempt", () => {
    const { result } = setup();
    for (let i = 0; i <= CAMERA_CHECK_MAX_ATTEMPTS; i++) feed(dark, i * CAMERA_CHECK_ATTEMPT_MS);

    expect(result.current.attempt).toBe(CAMERA_CHECK_MAX_ATTEMPTS);
    expect(result.current.canSkip).toBe(true);
    expect(result.current.outcome).toMatchObject({
      passed: false,
      reason: "attempts_exhausted",
      failed_attempts: CAMERA_CHECK_MAX_ATTEMPTS,
      last_checks: { bright: false },
    });
  });

  it("can't be skipped before the attempts are used up", () => {
    const { result } = setup();
    feed(dark, 0);
    feed(dark, CAMERA_CHECK_ATTEMPT_MS);
    expect(result.current.attempt).toBe(2);
    expect(result.current.canSkip).toBe(false);
  });

  it("can be skipped when the detector won't load", () => {
    const { result } = setup();
    act(() => watch.onGiveUp("load_failed", "404"));
    expect(result.current.status).toBe("unavailable");
    expect(result.current.canSkip).toBe(true);
    expect(result.current.outcome.reason).toBe("model_unavailable");
  });

  it("can be skipped when the camera fails", () => {
    const { result } = setup();
    act(() => result.current.onCameraStatus("ok"));
    expect(result.current.status).toBe("starting");
    act(() => result.current.onCameraStatus("engine-error"));
    expect(result.current.outcome.reason).toBe("camera_error");
  });

  it("gives up waiting for a first frame", () => {
    const { result } = setup();
    act(() => vi.advanceTimersByTime(CAMERA_CHECK_START_TIMEOUT_MS));
    expect(result.current.canSkip).toBe(true);
    expect(result.current.outcome.reason).toBe("start_timeout");
  });
});
