/**
 * Shared webcam frame-capture helpers.
 *
 * Single implementation used by both the proctoring loop (base64 frame → CV
 * /detect) and the face-match monitor (File → /continuous-verify), so the
 * readiness guard and capture logic can't drift apart.
 */

/** True when the video element currently has a decodable frame. */
export function isVideoReady(video) {
  return (
    !!video &&
    video.readyState >= 2 && // HAVE_CURRENT_DATA
    !video.paused &&
    !video.ended &&
    video.videoWidth > 0 &&
    video.videoHeight > 0
  );
}

let sharedCanvas = null;

/** Draws the current frame to a canvas, scaled down (never up) to fit maxWidth/maxHeight. Returns null if the video isn't ready. */
export function captureCanvas(video, { maxWidth, maxHeight } = {}) {
  if (!isVideoReady(video)) return null;

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = maxWidth && maxHeight ? Math.min(maxWidth / vw, maxHeight / vh, 1) : 1;
  const w = Math.max(1, Math.round(vw * scale));
  const h = Math.max(1, Math.round(vh * scale));

  if (!sharedCanvas) sharedCanvas = document.createElement("canvas");
  if (sharedCanvas.width !== w) sharedCanvas.width = w;
  if (sharedCanvas.height !== h) sharedCanvas.height = h;
  sharedCanvas.getContext("2d").drawImage(video, 0, 0, w, h);
  return sharedCanvas;
}

export function dataUrlToFile(dataUrl, filename) {
  const [meta, b64] = dataUrl.split(",");
  const mime = meta.match(/:(.*?);/)?.[1] ?? "image/jpeg";
  const bstr = atob(b64);
  let n = bstr.length;
  const u8 = new Uint8Array(n);
  while (n--) u8[n] = bstr.charCodeAt(n);
  return new File([u8], filename, { type: mime });
}

export function captureFrameBase64(video, opts = {}) {
  const canvas = captureCanvas(video, opts);
  if (!canvas) return null;
  return canvas.toDataURL("image/jpeg", opts.quality ?? 0.92).split(",")[1];
}

export function captureFrameFile(video, filename = "frame.jpg", opts = {}) {
  const canvas = captureCanvas(video, opts);
  if (!canvas) return null;
  return dataUrlToFile(canvas.toDataURL("image/jpeg", opts.quality ?? 0.92), filename);
}
