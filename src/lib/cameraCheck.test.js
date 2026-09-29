import { evaluateFrame, meanLuminance, passesAll } from "./cameraCheck";
import { CAMERA_CHECK_MIN_LUMINANCE } from "@/config/interview";

const face = (originX, originY, width = 200, height = 200) => ({
  boundingBox: { originX, originY, width, height },
});

const frame = (detections, luminance = 120) =>
  evaluateFrame({ detections, width: 640, height: 480, luminance });

describe("evaluateFrame", () => {
  it("passes one centred, well-lit face", () => {
    const checks = frame([face(220, 140)]);
    expect(checks).toEqual({ oneFace: true, centred: true, bright: true });
    expect(passesAll(checks)).toBe(true);
  });

  it("fails with nobody or with two people", () => {
    expect(frame([]).oneFace).toBe(false);
    expect(frame([face(0, 0), face(400, 200)]).oneFace).toBe(false);
    expect(frame([face(0, 0), face(400, 200)]).centred).toBe(false);
  });

  it("fails a face pushed to the edge", () => {
    expect(frame([face(0, 140)]).centred).toBe(false);
    expect(frame([face(220, 0, 200, 100)]).centred).toBe(false);
  });

  it("fails a dark frame and lets an unreadable one through", () => {
    expect(frame([face(220, 140)], CAMERA_CHECK_MIN_LUMINANCE - 1).bright).toBe(false);
    expect(frame([face(220, 140)], null).bright).toBe(true);
  });
});

describe("meanLuminance", () => {
  it("weights the channels like the eye does", () => {
    expect(meanLuminance(new Uint8ClampedArray([255, 255, 255, 255]))).toBeCloseTo(255);
    expect(meanLuminance(new Uint8ClampedArray([0, 255, 0, 255, 0, 0, 0, 255]))).toBeCloseTo(
      0.7152 * 127.5,
    );
    expect(meanLuminance(new Uint8ClampedArray([]))).toBe(0);
  });
});
