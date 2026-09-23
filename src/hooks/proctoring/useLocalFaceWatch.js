import { useEffect, useRef } from "react";
import { loadFaceDetector } from "@/lib/localFaceDetector";
import { isVideoReady } from "@/lib/videoCapture";
import { recordViolationEvent } from "@/lib/violationLog";
import { logger } from "@/lib/logger";

export const LOCAL_FACE_INTERVAL_MS = 300;
// A count has to hold this many samples in a row, so one missed detection
// doesn't send the server a frame.
const HOLD_SAMPLES = 2;
// A device this slow to analyse a frame can't keep up, and the watch stops
// rather than slow the interview down.
const SLOW_FRAME_MS = 150;
const MAX_SLOW_FRAMES = 5;

const facesOf = (count) => (count === 0 ? "none" : count === 1 ? "one" : "multiple");

const record = (outcome, extra) =>
  recordViolationEvent({ source: "local", type: "LOCAL_FACE", outcome, ...extra });

/**
 * Counts faces on the device a few times a second and, when the count
 * changes, calls `onChange` so the server can look at once instead of at the
 * next scheduled check. It never strikes by itself: the server check decides,
 * under the same rules as always.
 */
export function useLocalFaceWatch(videoRef, isActive, onChange) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!isActive) return;
    let stopped = false;
    let timer = null;

    const giveUp = (reason, error) => {
      stopped = true;
      logger.warn(`[LocalFaceWatch] stopped: ${reason}`, error ?? "");
      record("unavailable", { reason, ...(error ? { error } : {}) });
    };

    loadFaceDetector().then(
      (detector) => {
        if (stopped) return;
        let stable = null;
        let candidate = null;
        let seen = 0;
        let slow = 0;
        let lastTime = 0;

        const step = () => {
          if (stopped) return;
          const video = videoRef.current;
          if (video && isVideoReady(video)) {
            const started = performance.now();
            // Timestamps have to keep increasing, even between two calls in one millisecond.
            lastTime = Math.max(started, lastTime + 1);
            let faces;
            try {
              faces = facesOf(detector.detectForVideo(video, lastTime).detections.length);
            } catch (err) {
              giveUp("detect_failed", err?.message);
              return;
            }

            slow = performance.now() - started > SLOW_FRAME_MS ? slow + 1 : 0;
            if (slow >= MAX_SLOW_FRAMES) {
              giveUp("too_slow");
              return;
            }

            seen = faces === candidate ? seen + 1 : 1;
            candidate = faces;
            if (seen === HOLD_SAMPLES && faces !== stable) {
              const previous = stable;
              stable = faces;
              if (previous !== null) {
                record("changed", { faces, previous });
                onChangeRef.current?.(faces, previous);
              }
            }
          }
          timer = setTimeout(step, LOCAL_FACE_INTERVAL_MS);
        };
        step();
      },
      (err) => {
        if (!stopped) giveUp("load_failed", err?.message);
      },
    );

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [isActive, videoRef]);
}
