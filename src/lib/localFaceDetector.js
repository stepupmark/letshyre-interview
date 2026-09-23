// Served from our own origin: the page's CSP and the desktop app allow no
// other. The WASM is about 12 MB, so it loads on first use, never with the app.
const BASE = `${import.meta.env.BASE_URL}mediapipe`;

let loading = null;

export function loadFaceDetector() {
  loading ??= (async () => {
    const { FaceDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);
    return FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${BASE}/blaze_face_short_range.tflite`, delegate: "CPU" },
      runningMode: "VIDEO",
      minDetectionConfidence: 0.5,
    });
  })();
  // A failed load is tried again by the next interview rather than cached.
  loading.catch(() => {
    loading = null;
  });
  return loading;
}
