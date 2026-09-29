import { CAMERA_CHECK_CENTRE_TOLERANCE, CAMERA_CHECK_MIN_LUMINANCE } from "@/config/interview";

const SAMPLE_WIDTH = 32;
const SAMPLE_HEIGHT = 24;

export function meanLuminance(rgba) {
  let total = 0;
  const pixels = rgba.length / 4;
  for (let i = 0; i < rgba.length; i += 4) {
    total += 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
  }
  return pixels ? total / pixels : 0;
}

let sampleCanvas = null;

// Null where the frame can't be read, e.g. without a 2D canvas.
export function sampleLuminance(video) {
  try {
    sampleCanvas ??= document.createElement("canvas");
    sampleCanvas.width = SAMPLE_WIDTH;
    sampleCanvas.height = SAMPLE_HEIGHT;
    const ctx = sampleCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    return meanLuminance(ctx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data);
  } catch {
    return null;
  }
}

/**
 * Which camera checks one frame passes. An unreadable brightness doesn't hold
 * the candidate back: the face checks already show the camera can see them.
 */
export function evaluateFrame({ detections, width, height, luminance }) {
  const oneFace = detections.length === 1;
  let centred = false;
  if (oneFace && width > 0 && height > 0) {
    const box = detections[0].boundingBox;
    const dx = (box.originX + box.width / 2) / width - 0.5;
    const dy = (box.originY + box.height / 2) / height - 0.5;
    centred =
      Math.abs(dx) <= CAMERA_CHECK_CENTRE_TOLERANCE &&
      Math.abs(dy) <= CAMERA_CHECK_CENTRE_TOLERANCE;
  }
  const bright = luminance === null || luminance >= CAMERA_CHECK_MIN_LUMINANCE;
  return { oneFace, centred, bright };
}

export const passesAll = (checks) => checks.oneFace && checks.centred && checks.bright;
