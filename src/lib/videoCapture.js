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
let scaledCanvas = null;

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

/**
 * One draw of the video, two payloads: the downscaled base64 that detection
 * sends and the full-size File that face verification sends. Capturing them
 * separately let the two checks describe different moments.
 */
export function captureSample(video, opts = {}) {
  const source = captureCanvas(video);
  if (!source) return null;

  const file = dataUrlToFile(
    source.toDataURL("image/jpeg", opts.fileQuality ?? 0.92),
    opts.filename ?? "frame.jpg",
  );

  const { maxWidth, maxHeight } = opts;
  const scale =
    maxWidth && maxHeight ? Math.min(maxWidth / source.width, maxHeight / source.height, 1) : 1;
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));

  if (!scaledCanvas) scaledCanvas = document.createElement("canvas");
  if (scaledCanvas.width !== w) scaledCanvas.width = w;
  if (scaledCanvas.height !== h) scaledCanvas.height = h;
  scaledCanvas.getContext("2d").drawImage(source, 0, 0, w, h);

  return {
    frame: scaledCanvas.toDataURL("image/jpeg", opts.quality ?? 0.92).split(",")[1],
    file,
    capturedAt: Date.now(),
  };
}
