import { useEffect, useRef } from "react";
import { loadObjectDetector } from "@/lib/localObjectDetector";
import { recordViolationEvent } from "@/lib/violationLog";
import { startLocalWatch } from "./localWatch";

export const LOCAL_OBJECT_INTERVAL_MS = 1_000;
// A phone has to be seen this many samples in a row, so one stray box
// doesn't send the server a frame.
const HOLD_SAMPLES = 2;
// The model runs in a worker, so a slow frame costs the page nothing until
// answers stop keeping up with the samples.
const SLOW_FRAME_MS = LOCAL_OBJECT_INTERVAL_MS;
const LABEL = "cell phone";

const record = (outcome, extra) =>
  recordViolationEvent({ source: "local", type: "LOCAL_OBJECT", outcome, ...extra });

const bestScore = (phones) => Math.max(0, ...phones.map((phone) => phone.score));

/**
 * Looks for a phone on the device once a second and, when one appears, calls
 * `onPhone` so the server can look at once. Like the face watch it never
 * strikes by itself.
 */
export function useLocalObjectWatch(videoRef, isActive, onPhone) {
  const onPhoneRef = useRef(onPhone);
  useEffect(() => {
    onPhoneRef.current = onPhone;
  });

  useEffect(() => {
    if (!isActive) return;
    let present = false;
    let seen = 0;

    return startLocalWatch({
      name: "LocalObjectWatch",
      videoRef,
      load: loadObjectDetector,
      detect: (detector, video, time) => detector.detect(video, time),
      intervalMs: LOCAL_OBJECT_INTERVAL_MS,
      slowFrameMs: SLOW_FRAME_MS,
      onResult: ({ phones }) => {
        if (!phones.length) {
          present = false;
          seen = 0;
          return;
        }
        seen += 1;
        if (present || seen < HOLD_SAMPLES) return;
        present = true;
        const score = Math.round(bestScore(phones) * 100) / 100;
        record("changed", { label: LABEL, score });
        onPhoneRef.current?.(score);
      },
      onGiveUp: (reason, error) => record("unavailable", { reason, ...(error ? { error } : {}) }),
    });
  }, [isActive, videoRef]);
}
