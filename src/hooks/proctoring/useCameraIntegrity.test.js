import { act, renderHook } from "@testing-library/react";
import {
  CAMERA_INTEGRITY_INTERVAL_MS,
  FROZEN_AFTER_MS,
  useCameraIntegrity,
} from "./useCameraIntegrity";
import { subscribeToViolationLog } from "@/lib/violationLog";

vi.mock("@/lib/videoCapture", () => ({ isVideoReady: () => true }));

const PIXELS = 16 * 16;

// A 16x16 picture: a gradient, shifted by `offset` and nudged by `noise` on
// every pixel so consecutive frames differ the way a real sensor's do.
function frame(offset = 0, noise = 0) {
  const data = new Uint8ClampedArray(PIXELS * 4);
  for (let i = 0; i < PIXELS; i++) {
    const value = (i % 200) + 20 + offset + (noise && (i % 2 ? noise : -noise));
    data.set([value, value, value, 255], i * 4);
  }
  return { data };
}

let frames;
let events;
let stop;

beforeEach(() => {
  vi.useFakeTimers();
  events = [];
  stop = subscribeToViolationLog((event) => events.push(event));
  frames = [frame()];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({
    drawImage: vi.fn(),
    getImageData: () => (frames.length > 1 ? frames.shift() : frames[0]),
  }));
});

afterEach(() => {
  stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function videoWith(label) {
  return { current: { srcObject: { getVideoTracks: () => [{ label }] } } };
}

function watch(videoRef = videoWith("Integrated Camera"), isActive = true) {
  return renderHook(() => useCameraIntegrity(videoRef, isActive));
}

const seconds = (n) =>
  act(async () => vi.advanceTimersByTimeAsync(CAMERA_INTEGRITY_INTERVAL_MS * n));

const integrity = () => events.filter((e) => e.type === "CAMERA_INTEGRITY");

describe("useCameraIntegrity", () => {
  it.each(["OBS Virtual Camera", "ManyCam Virtual Webcam", "Snap Camera", "DroidCam Source 3"])(
    "logs %s as a virtual camera once",
    async (label) => {
      watch(videoWith(label));
      await seconds(5);

      expect(integrity()).toEqual([
        expect.objectContaining({
          source: "camera",
          outcome: "shadow",
          reason: "virtual_camera",
          label,
          category: "detection",
          counts_as_strike: false,
        }),
      ]);
    },
  );

  it.each(["Integrated Camera (04f2:b6dd)", "Logitech BRIO", "FaceTime HD Camera"])(
    "leaves %s alone",
    async (label) => {
      frames = Array.from({ length: 20 }, (_, i) => frame(0, (i % 3) + 1));
      watch(videoWith(label));
      await seconds(15);
      expect(integrity()).toEqual([]);
    },
  );

  it("logs a picture that stays identical for ten seconds, once", async () => {
    watch();
    await seconds(FROZEN_AFTER_MS / CAMERA_INTEGRITY_INTERVAL_MS);
    expect(integrity()).toEqual([]);

    await seconds(20);
    expect(integrity()).toEqual([
      expect.objectContaining({
        outcome: "shadow",
        reason: "frozen_picture",
        frozen_ms: FROZEN_AFTER_MS,
      }),
    ]);
  });

  it("logs the recovery when the picture moves again", async () => {
    frames = [...Array.from({ length: 13 }, () => frame()), frame(10)];
    watch();
    await seconds(15);

    expect(integrity()).toEqual([
      expect.objectContaining({ outcome: "shadow", reason: "frozen_picture" }),
      expect.objectContaining({
        outcome: "recovered",
        reason: "frozen_picture",
        frozen_ms: 13_000,
      }),
    ]);
  });

  it("does not count a black frame as frozen", async () => {
    frames = [{ data: new Uint8ClampedArray(PIXELS * 4) }];
    watch();
    await seconds(20);
    expect(integrity()).toEqual([]);
  });

  it("does not count a still room with sensor noise as frozen", async () => {
    frames = Array.from({ length: 30 }, (_, i) => frame(0, i % 2));
    watch();
    await seconds(25);
    expect(integrity()).toEqual([]);
  });

  it("does nothing while the interview is inactive", async () => {
    watch(videoWith("OBS Virtual Camera"), false);
    await seconds(20);
    expect(integrity()).toEqual([]);
  });

  it("stops when it is unmounted", async () => {
    const { unmount } = watch();
    await seconds(5);
    unmount();
    await seconds(20);
    expect(integrity()).toEqual([]);
  });
});
