import axios from "axios";
import { api } from "./axiosClient.api";
import { logger } from "@/lib/logger";

// AI Detection API uses a different base URL
const aiApi = axios.create({
  baseURL: `${import.meta.env.VITE_AI_DETECTION_URL}`,
  timeout: 10000,
  headers: {
    "Content-Type": "application/json",
  },
});

/**
 * Sends a base64 frame to the AI detection engine.
 * @param {string} frame - Base64 encoded JPEG image
 */
export async function detectFrame(frame) {
  logger.log("[AI API] 📸 Sending image to AI engine... (size:", frame?.length, "chars)");
  const response = await aiApi.post("/api/v1/detect", { frame: frame });
  return response.data;
}

/**
 * Submits a batch of proctoring logs to the Django backend.
 * @param {Object} payload - The batch log payload
 */
export async function submitProctoringLogs(payload) {
  const response = await api.post("/user/v1/candidate/interview/proctoring/log/", payload, {
    headers: {
      "Content-Type": "application/json",
    },
  });
  return response.data;
}
