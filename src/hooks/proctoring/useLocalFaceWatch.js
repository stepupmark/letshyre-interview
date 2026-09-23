import { useEffect, useRef } from "react";
import { loadFaceDetector } from "@/lib/localFaceDetector";
import { recordViolationEvent } from "@/lib/violationLog";
import { startLocalWatch } from "./localWatch";

export const LOCAL_FACE_INTERVAL_MS = 300;
// A count has to hold this many samples in a row, so one missed detection
// doesn't send the server a frame.
const HOLD_SAMPLES = 2;
const SLOW_FRAME_MS = 150;

const facesOf = (count) => (count === 0 ? "none" : count === 1 ? "one" : "multiple");

const record = (outcome, extra) =>
  recordViolationEvent({ source: "local", type: "LOCAL_FACE", outcome, ...extra });

/**
 * Counts faces on the device a few times a second and, when the count
 * changes, calls `onChange` so the server can look at once instead of at the
 * next scheduled check. It never strikes by itself: the server check decides,
 * under the same rules as always.
 *
 * Returns a ref to the latest stable count ("none" | "one" | "multiple"), or
 * null while the watch isn't running.
 */
export function useLocalFaceWatch(videoRef, isActive, onChange) {
  const facesRef = useRef(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!isActive) return;
    let stable = null;
    let candidate = null;
    let seen = 0;

    const stop = startLocalWatch({
      name: "LocalFaceWatch",
      videoRef,
      load: loadFaceDetector,
      detect: (detector, video, time) =>
        facesOf(detector.detectForVideo(video, time).detections.length),
      intervalMs: LOCAL_FACE_INTERVAL_MS,
      slowFrameMs: SLOW_FRAME_MS,
      onResult: (faces) => {
        seen = faces === candidate ? seen + 1 : 1;
        candidate = faces;
        if (seen !== HOLD_SAMPLES || faces === stable) return;
        const previous = stable;
        stable = faces;
        facesRef.current = faces;
        if (previous !== null) {
          record("changed", { faces, previous });
          onChangeRef.current?.(faces, previous);
        }
      },
      onGiveUp: (reason, error) => {
        facesRef.current = null;
        record("unavailable", { reason, ...(error ? { error } : {}) });
      },
    });

    return () => {
      stop();
      facesRef.current = null;
    };
  }, [isActive, videoRef]);

  return facesRef;
}
