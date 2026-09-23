import { api } from "./clients/backend";
import { aiDetectionClient } from "./clients/aiDetection";
import { logger } from "@/lib/logger";

// A hung request would hold up every check behind it; the next one is due in seconds anyway.
const DETECT_TIMEOUT_MS = 4_000;

/**
 * Sends a base64 frame to the AI detection engine.
 * @param {string} frame - Base64 encoded JPEG image
 */
export async function detectFrame(frame) {
  logger.log("[AI API] 📸 Sending image to AI engine... (size:", frame?.length, "chars)");
  const response = await aiDetectionClient.post(
    "/api/v1/detect",
    { frame },
    { timeout: DETECT_TIMEOUT_MS },
  );
  return response.data;
}

/**
 * Submits a batch of proctoring logs to the Django backend.
 * @param {Object} payload - The batch log payload
 */
export async function submitProctoringLogs(payload) {
  const response = await api.post("/user/v1/candidate/interview/proctoring/log/", payload);
  return response.data;
}
