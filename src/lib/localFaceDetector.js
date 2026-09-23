import { WASM_BASE, modelPath, sharedDetector } from "@/lib/mediapipe";

export const loadFaceDetector = sharedDetector(async () => {
  const { FaceDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");
  const files = await FilesetResolver.forVisionTasks(WASM_BASE);
  return FaceDetector.createFromOptions(files, {
    baseOptions: { modelAssetPath: modelPath("blaze_face_short_range-v1.tflite"), delegate: "CPU" },
    runningMode: "VIDEO",
    minDetectionConfidence: 0.5,
  });
});
