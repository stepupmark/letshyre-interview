// A classic worker: MediaPipe loads its WASM with importScripts, which module
// workers lack. So this file imports nothing and takes MediaPipe's IIFE build
// from the same versioned folder as the WASM.

// The page's CSP doesn't reach a worker, so MediaPipe's usage logging would go
// out from here. Nothing this worker needs lives on another origin.
const fetchOwnOrigin = self.fetch.bind(self);
self.fetch = (input, init) =>
  new URL(input.url ?? input, self.location.href).origin === self.location.origin
    ? fetchOwnOrigin(input, init)
    : Promise.reject(new TypeError("blocked"));

let detector = null;

const reply = (message) => self.postMessage(message);
const failure = (err) => ({ type: "error", error: String(err?.message ?? err) });

async function load({ wasmBase, options }) {
  try {
    self.importScripts(`${wasmBase}/vision_bundle.js`);
    const { FilesetResolver, ObjectDetector } = self.Vision;
    const files = await FilesetResolver.forVisionTasks(wasmBase);
    detector = await ObjectDetector.createFromOptions(files, options);
    reply({ type: "ready" });
  } catch (err) {
    reply(failure(err));
  }
}

function detect({ frame, timestamp }) {
  try {
    const started = performance.now();
    const { detections } = detector.detectForVideo(frame, timestamp);
    reply({
      type: "result",
      phones: detections.map((d) => ({ score: d.categories[0]?.score ?? 0 })),
      ms: performance.now() - started,
    });
  } catch (err) {
    reply(failure(err));
  } finally {
    frame.close();
  }
}

self.onmessage = ({ data }) => (data.type === "load" ? load(data) : detect(data));
