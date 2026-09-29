import { useCallback, useEffect, useState } from "react";
import { loadFaceDetector } from "@/lib/localFaceDetector";
import { evaluateFrame, passesAll, sampleLuminance } from "@/lib/cameraCheck";
import { startLocalWatch } from "@hooks/proctoring/localWatch";
import {
  CAMERA_CHECK_ATTEMPT_MS,
  CAMERA_CHECK_HOLD_MS,
  CAMERA_CHECK_MAX_ATTEMPTS,
  CAMERA_CHECK_START_TIMEOUT_MS,
} from "@/config/interview";

const INTERVAL_MS = 200;

function detectFrame(detector, video, time) {
  return {
    ...evaluateFrame({
      detections: detector.detectForVideo(video, time).detections,
      width: video.videoWidth,
      height: video.videoHeight,
      luminance: sampleLuminance(video),
    }),
    at: time,
  };
}

/**
 * Watches the preview until one well-lit, centred face has held for
 * CAMERA_CHECK_HOLD_MS. After CAMERA_CHECK_MAX_ATTEMPTS failed attempts, or
 * when the camera or the detector can't run at all, the candidate may skip it.
 * Only a virtual camera to show is "blocked": no skipping, only retry once a
 * real webcam is connected.
 *
 * status: "starting" | "checking" | "passed" | "unavailable" | "blocked"
 */
export function useCameraCheck(videoRef) {
  const [status, setStatus] = useState("starting");
  const [checks, setChecks] = useState(null);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [unavailableReason, setUnavailableReason] = useState(null);
  const [cameraKey, setCameraKey] = useState(0);

  const settled = status === "passed" || status === "unavailable" || status === "blocked";

  useEffect(() => {
    if (settled) return;
    let passingSince = null;
    let attemptStartedAt = null;

    return startLocalWatch({
      name: "CameraCheck",
      videoRef,
      load: loadFaceDetector,
      detect: detectFrame,
      intervalMs: INTERVAL_MS,
      // Slow is fine here: nothing else is running yet.
      slowFrameMs: Infinity,
      onResult: ({ at, ...frame }) => {
        attemptStartedAt ??= at;
        setChecks(frame);
        if (passesAll(frame)) {
          passingSince ??= at;
          if (at - passingSince >= CAMERA_CHECK_HOLD_MS) {
            setStatus("passed");
            return;
          }
        } else {
          passingSince = null;
        }
        setStatus("checking");
        if (at - attemptStartedAt >= CAMERA_CHECK_ATTEMPT_MS) {
          attemptStartedAt = at;
          setFailedAttempts((n) => n + 1);
        }
      },
      onGiveUp: (reason) => {
        setUnavailableReason(reason === "load_failed" ? "model_unavailable" : reason);
        setStatus("unavailable");
      },
    });
  }, [settled, videoRef]);

  useEffect(() => {
    if (status !== "starting") return;
    const id = setTimeout(() => {
      setUnavailableReason("start_timeout");
      setStatus("unavailable");
    }, CAMERA_CHECK_START_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [status]);

  // Takes CandidateCameraCard's status reports.
  const onCameraStatus = useCallback((cameraStatus) => {
    if (cameraStatus === "virtual-camera") {
      setUnavailableReason("virtual_camera");
      setStatus("blocked");
      return;
    }
    if (cameraStatus !== "engine-error") return;
    setUnavailableReason("camera_error");
    setStatus((current) => (current === "blocked" ? current : "unavailable"));
  }, []);

  // Remounts the camera (via cameraKey) to look for a real webcam again.
  const retry = useCallback(() => {
    setUnavailableReason(null);
    setStatus("starting");
    setCameraKey((key) => key + 1);
  }, []);

  const attemptsUsed = failedAttempts >= CAMERA_CHECK_MAX_ATTEMPTS;

  return {
    status,
    checks,
    attempt: Math.min(failedAttempts + 1, CAMERA_CHECK_MAX_ATTEMPTS),
    maxAttempts: CAMERA_CHECK_MAX_ATTEMPTS,
    canContinue: status === "passed",
    canSkip:
      status === "unavailable" || (status !== "passed" && status !== "blocked" && attemptsUsed),
    onCameraStatus,
    retry,
    cameraKey,
    outcome:
      status === "passed"
        ? { passed: true, failed_attempts: failedAttempts }
        : {
            passed: false,
            reason: unavailableReason ?? (attemptsUsed ? "attempts_exhausted" : "incomplete"),
            failed_attempts: failedAttempts,
            ...(checks ? { last_checks: checks } : {}),
          },
  };
}
