import { isVideoReady } from "@/lib/videoCapture";
import { logger } from "@/lib/logger";

const MAX_SLOW_FRAMES = 5;

/**
 * Loads an on-device detector and runs `detect(detector, video, timestamp)` on
 * the camera every `intervalMs`, handing each result to `onResult`. An async
 * `detect` is awaited before the next sample is scheduled. It stops
 * for good, through `onGiveUp(reason, error)`, when the detector can't load,
 * throws, or is too slow for the device: a watch that can't keep up stops
 * rather than slow the interview down. Returns a function that stops it.
 */
export function startLocalWatch({
  name,
  videoRef,
  load,
  detect,
  onResult,
  onGiveUp,
  intervalMs,
  slowFrameMs,
}) {
  let stopped = false;
  let timer = null;

  const giveUp = (reason, error) => {
    stopped = true;
    logger.warn(`[${name}] stopped: ${reason}`, error ?? "");
    onGiveUp(reason, error);
  };

  load().then(
    (detector) => {
      if (stopped) return;
      let slow = 0;
      let lastTime = 0;

      const step = async () => {
        if (stopped) return;
        const video = videoRef.current;
        if (video && isVideoReady(video)) {
          const started = performance.now();
          // Timestamps have to keep increasing, even between two calls in one millisecond.
          lastTime = Math.max(started, lastTime + 1);
          let result;
          try {
            result = await detect(detector, video, lastTime);
          } catch (err) {
            if (!stopped) giveUp("detect_failed", err?.message);
            return;
          }
          if (stopped) return;

          slow = performance.now() - started > slowFrameMs ? slow + 1 : 0;
          if (slow >= MAX_SLOW_FRAMES) {
            giveUp("too_slow");
            return;
          }
          onResult(result);
        }
        timer = setTimeout(step, intervalMs);
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
}
