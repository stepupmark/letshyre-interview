import { useEffect } from "react";
import { isVideoReady } from "@/lib/videoCapture";
import { recordViolationEvent } from "@/lib/violationLog";

export const CAMERA_INTEGRITY_INTERVAL_MS = 1_000;
export const FROZEN_AFTER_MS = 10_000;
const SIZE = 16;
// Mean change per pixel (0-255) between two samples. Pixels are point-sampled,
// not averaged, so a real sensor's noise alone keeps a still room well above
// this; a frozen feed repeats the same frame exactly.
const STILL_DIFF = 0.25;
// A black or flat frame (covered lens, dark room) says nothing about freezing.
const MIN_CONTRAST = 10;

const VIRTUAL_CAMERA =
  /\bobs\b|manycam|xsplit|snap camera|droidcam|ivcam|epoccam|camtwist|splitcam|vcam|mmhmm|virtual/i;

const record = (outcome, extra) =>
  recordViolationEvent({ source: "camera", type: "CAMERA_INTEGRITY", outcome, ...extra });

function grayscale(ctx, video) {
  ctx.drawImage(video, 0, 0, SIZE, SIZE);
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
  const pixels = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000;
  }
  return pixels;
}

function meanDiff(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

const contrast = (pixels) => Math.max(...pixels) - Math.min(...pixels);

/**
 * Logs, for review only, a virtual camera and a picture that stops changing.
 * It never strikes and never shows the candidate anything.
 */
export function useCameraIntegrity(videoRef, isActive) {
  useEffect(() => {
    if (!isActive) return;
    let labelChecked = false;
    let ctx;
    let previous = null;
    let stillSince = null;
    let frozenLogged = false;

    const checkLabel = (video) => {
      const track = video.srcObject?.getVideoTracks?.()[0];
      if (!track) return;
      labelChecked = true;
      if (VIRTUAL_CAMERA.test(track.label)) {
        record("shadow", { reason: "virtual_camera", label: track.label });
      }
    };

    const checkFrozen = (video) => {
      if (ctx === undefined) {
        const canvas = document.createElement("canvas");
        canvas.width = SIZE;
        canvas.height = SIZE;
        ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) ctx.imageSmoothingEnabled = false;
      }
      if (!ctx) return;

      let pixels;
      try {
        pixels = grayscale(ctx, video);
      } catch {
        ctx = null;
        return;
      }
      const last = previous;
      previous = pixels;
      if (last === null) return;

      const now = Date.now();
      if (contrast(pixels) >= MIN_CONTRAST && meanDiff(pixels, last) < STILL_DIFF) {
        stillSince ??= now - CAMERA_INTEGRITY_INTERVAL_MS;
        if (!frozenLogged && now - stillSince >= FROZEN_AFTER_MS) {
          frozenLogged = true;
          record("shadow", { reason: "frozen_picture", frozen_ms: now - stillSince });
        }
        return;
      }
      if (frozenLogged) {
        record("recovered", { reason: "frozen_picture", frozen_ms: now - stillSince });
      }
      stillSince = null;
      frozenLogged = false;
    };

    // A hidden tab or a stopped video isn't evidence either way.
    const pause = () => {
      previous = null;
      if (!frozenLogged) stillSince = null;
    };

    const id = setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      if (!labelChecked) checkLabel(video);
      if (isVideoReady(video) && !document.hidden) checkFrozen(video);
      else pause();
    }, CAMERA_INTEGRITY_INTERVAL_MS);

    return () => clearInterval(id);
  }, [isActive, videoRef]);
}
