import { WASM_BASE, modelPath, sharedDetector } from "@/lib/mediapipe";

// The model takes about 150ms a frame, far too long for the page's own thread
// next to the editor, so it runs in a worker and only the frame grab is done here.
const FRAME_WIDTH = 320;
const DETECT_TIMEOUT_MS = 5_000;

const absolute = (path) => new URL(path, self.location.href).href;

function grabFrame(video) {
  return createImageBitmap(video, {
    resizeWidth: FRAME_WIDTH,
    resizeHeight: Math.round((FRAME_WIDTH * video.videoHeight) / video.videoWidth),
    resizeQuality: "low",
  });
}

/**
 * The worker as a detector: `detect(video, timestamp)` resolves to
 * `{ phones: [{ score }], ms }`. One frame at a time; the caller waits for the
 * answer before sending the next.
 */
function remoteDetector(worker) {
  let pending = null;
  let broken = null;

  const settle = (error, result) => {
    const current = pending;
    pending = null;
    if (!current) return;
    clearTimeout(current.timer);
    if (error) current.reject(error);
    else current.resolve(result);
  };

  worker.onmessage = ({ data }) =>
    data.type === "result" ? settle(null, data) : settle(new Error(data.error));
  worker.onerror = (event) => {
    broken = new Error(event.message || "worker crashed");
    settle(broken);
  };

  const send = async (video, timestamp) => {
    if (broken) throw broken;
    const frame = await grabFrame(video);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => settle(new Error("timeout")), DETECT_TIMEOUT_MS);
      pending = { resolve, reject, timer };
      worker.postMessage({ type: "detect", frame, timestamp }, [frame]);
    });
  };

  // A watch restarted mid-frame must not send a second one before the first is answered.
  let last = Promise.resolve();
  return {
    detect(video, timestamp) {
      const run = last.then(() => send(video, timestamp));
      last = run.catch(() => {});
      return run;
    },
  };
}

export const loadObjectDetector = sharedDetector(
  () =>
    new Promise((resolve, reject) => {
      const worker = new Worker(new URL("./objectDetector.worker.js", import.meta.url));
      const fail = (message) => {
        worker.terminate();
        reject(new Error(message));
      };
      worker.onerror = (event) => fail(event.message || "worker failed to start");
      worker.onmessage = ({ data }) =>
        data.type === "ready" ? resolve(remoteDetector(worker)) : fail(data.error);
      worker.postMessage({
        type: "load",
        wasmBase: absolute(WASM_BASE),
        options: {
          baseOptions: {
            modelAssetPath: absolute(modelPath("efficientdet_lite0-v1.tflite")),
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          categoryAllowlist: ["cell phone"],
          scoreThreshold: 0.3,
          maxResults: 3,
        },
      });
    }),
);
